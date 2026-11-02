import { randomBytes } from "node:crypto";

import { z } from "zod";

import { GROUP_PALETTE } from "../shared/project-groups.ts";
import { FAMILY_ORDER, type Family } from "../shared/projects-architecture.ts";
import type { ProjectMapState } from "./projects.ts";


const MAX_GROUPS = 50;
const MAX_LINKS = 500;
const LABEL_MAX = 60;
const REF_PREFIX = "ref:";

const FAMILY_LABEL: Record<Family, string> = {
  tests: "Tests", docs: "Documentation", i18n: "Traductions", data: "Données", config: "Configuration",
  scripts: "Scripts", assets: "Ressources", ui: "Interface", server: "Serveur", other: "Autre",
};

const text = z.string().max(500);
const id = z.string().min(1).max(200);
const groupRef = z.string().min(1).max(60);
const family = z.enum(FAMILY_ORDER as [Family, ...Family[]]);

export const projectChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create_group"), name: text, color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), ref: z.string().regex(/^[\w-]{1,40}$/).optional() }).strict(),
  z.object({ op: z.literal("rename_group"), groupId: groupRef, name: text }).strict(),
  z.object({ op: z.literal("delete_group"), groupId: groupRef }).strict(),
  z.object({ op: z.literal("assign"), projectId: id, groupId: groupRef.nullable() }).strict(),
  z.object({ op: z.literal("link"), a: id, b: id, label: text.optional() }).strict(),
  z.object({ op: z.literal("unlink"), a: id, b: id }).strict(),
  z.object({ op: z.literal("rename_family"), projectId: id, family, name: text }).strict(),
  z.object({ op: z.literal("move_module"), projectId: id, moduleId: z.string().min(1).max(300), family }).strict(),
]);
export const projectChangesSchema = z.array(projectChangeSchema).min(1).max(100);

export type ProjectChange =
  | { op: "create_group"; name: string; color?: string; ref?: string }
  | { op: "rename_group"; groupId: string; name: string }
  | { op: "delete_group"; groupId: string }
  | { op: "assign"; projectId: string; groupId: string | null }
  | { op: "link"; a: string; b: string; label?: string }
  | { op: "unlink"; a: string; b: string }
  | { op: "rename_family"; projectId: string; family: Family; name: string }
  | { op: "move_module"; projectId: string; moduleId: string; family: Family };

export interface KnownProjects {
  projectIds: ReadonlySet<string>;
  /** null when the project's modules are not known; its module ids are then not checked. */
  moduleIds?: (projectId: string) => ReadonlySet<string> | null;
}

export type ApplyResult = { ok: true; state: ProjectMapState } | { ok: false; problems: { index: number; reason: string }[] };

const SPACES = /[\s\u0085]+/g;
/** Control, format, private-use, unassigned and lone surrogate code points, tag characters, variation selectors and the
 * Hangul fillers, all of which can hide text; and the guillemets the card quotes each name with. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\u{E0000}-\u{E007F}\u{FE00}-\u{FE0F}\u3164\u115F\u1160\uFFA0«»]/gu;

/** One line a person can read on an approval card: nothing hidden, no guillemets, single spaces, at most 60 UTF-16 units. */
export function cleanLabel(value: string): string {
  const flat = value.replace(SPACES, " ").replace(INVISIBLE, "").replace(/ {2,}/g, " ").trim();
  if (flat.length <= LABEL_MAX) return flat;
  const end = /[\ud800-\udbff]/.test(flat[LABEL_MAX - 1]!) ? LABEL_MAX - 1 : LABEL_MAX;
  return flat.slice(0, end).trimEnd();
}

/** A name on the card, quoted so no name can pass for the words around it. */
const quoted = (value: string) => `«${cleanLabel(value)}»`;

const sameLink = (l: { a: string; b: string }, a: string, b: string) => (l.a === a && l.b === b) || (l.a === b && l.b === a);
const sameName = (x: string, y: string) => x.toLocaleLowerCase("fr") === y.toLocaleLowerCase("fr");

function newGroupId(taken: ReadonlySet<string>): string {
  for (;;) {
    const candidate = `g${randomBytes(6).toString("hex")}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Applies the batch to a copy of `state`, or lists every change that cannot apply; one problem means nothing applies. */
export function applyChanges(state: ProjectMapState, changes: ProjectChange[], known: KnownProjects): ApplyResult {
  const next = structuredClone(state);
  const refs = new Map<string, string>();
  const problems: { index: number; reason: string }[] = [];

  const resolveGroup = (groupId: string): string | null => {
    const real = groupId.startsWith(REF_PREFIX) ? refs.get(groupId.slice(REF_PREFIX.length)) : groupId;
    return real !== undefined && next.groups.some((g) => g.id === real) ? real : null;
  };
  const nameTaken = (name: string, except?: string) => next.groups.some((g) => g.id !== except && sameName(g.name, name));
  const project = (projectId: string) => (known.projectIds.has(projectId) ? null : `Unknown project ${projectId}`);

  const step = (change: ProjectChange): string | null => {
    switch (change.op) {
      case "create_group": {
        const name = cleanLabel(change.name);
        if (!name) return "A group needs a name";
        if (nameTaken(name)) return `A group named ${name} already exists`;
        if (next.groups.length >= MAX_GROUPS) return `There can be at most ${MAX_GROUPS} groups`;
        if (change.ref !== undefined && refs.has(change.ref)) return `The ref ${change.ref} is already used in this batch`;
        const used = new Set(next.groups.map((g) => g.color.toLowerCase()));
        const color = change.color ?? GROUP_PALETTE.find((c) => !used.has(c)) ?? GROUP_PALETTE[next.groups.length % GROUP_PALETTE.length];
        const groupId = newGroupId(new Set(next.groups.map((g) => g.id)));
        next.groups.push({ id: groupId, name, color });
        if (change.ref !== undefined) refs.set(change.ref, groupId);
        return null;
      }
      case "rename_group": {
        const groupId = resolveGroup(change.groupId);
        if (!groupId) return `Unknown group ${change.groupId}`;
        const name = cleanLabel(change.name);
        if (!name) return "A group needs a name";
        if (nameTaken(name, groupId)) return `A group named ${name} already exists`;
        next.groups = next.groups.map((g) => (g.id === groupId ? { ...g, name } : g));
        return null;
      }
      case "delete_group": {
        const groupId = resolveGroup(change.groupId);
        if (!groupId) return `Unknown group ${change.groupId}`;
        next.groups = next.groups.filter((g) => g.id !== groupId);
        next.member = Object.fromEntries(Object.entries(next.member).filter(([, g]) => g !== groupId));
        return null;
      }
      case "assign": {
        const unknown = project(change.projectId);
        if (unknown) return unknown;
        if (change.groupId === null) {
          delete next.member[change.projectId];
          return null;
        }
        const groupId = resolveGroup(change.groupId);
        if (!groupId) return `Unknown group ${change.groupId}`;
        next.member[change.projectId] = groupId;
        return null;
      }
      case "link": {
        const unknown = project(change.a) ?? project(change.b);
        if (unknown) return unknown;
        if (change.a === change.b) return "A project cannot be linked to itself";
        if (next.links.some((l) => sameLink(l, change.a, change.b))) return `${change.a} and ${change.b} are already linked`;
        if (next.links.length >= MAX_LINKS) return `There can be at most ${MAX_LINKS} links`;
        next.links.push({ a: change.a, b: change.b, label: cleanLabel(change.label ?? "") });
        return null;
      }
      case "unlink": {
        if (!next.links.some((l) => sameLink(l, change.a, change.b))) return `${change.a} and ${change.b} are not linked`;
        next.links = next.links.filter((l) => !sameLink(l, change.a, change.b));
        return null;
      }
      case "rename_family":
      case "move_module": {
        const unknown = project(change.projectId);
        if (unknown) return unknown;
        if (change.op === "move_module") {
          const modules = known.moduleIds?.(change.projectId) ?? null;
          if (modules && !modules.has(change.moduleId)) return `Unknown module ${change.moduleId} in ${change.projectId}`;
        }
        const name = change.op === "rename_family" ? cleanLabel(change.name) : "";
        if (change.op === "rename_family" && !name) return "A family needs a name";
        const own = Object.hasOwn(next.overrides, change.projectId) ? next.overrides[change.projectId] : { moduleFamily: {}, familyNames: {} };
        next.overrides[change.projectId] = change.op === "rename_family"
          ? { ...own, familyNames: { ...own.familyNames, [change.family]: name } }
          : { ...own, moduleFamily: { ...own.moduleFamily, [change.moduleId]: change.family } };
        return null;
      }
    }
  };

  changes.forEach((change, index) => {
    const reason = step(change);
    if (reason) problems.push({ index, reason });
  });
  return problems.length ? { ok: false, problems } : { ok: true, state: next };
}

/** One French line per change, built from the changes only; every name is cleaned and quoted. */
export function describeChanges(changes: ProjectChange[], names: { project: (id: string) => string; group: (id: string) => string }): string[] {
  const created = new Map<string, string>();
  const project = (projectId: string) => quoted(names.project(projectId));
  const group = (groupId: string) => quoted(groupId.startsWith(REF_PREFIX) ? created.get(groupId.slice(REF_PREFIX.length)) ?? groupId : names.group(groupId));
  return changes.map((change) => {
    switch (change.op) {
      case "create_group": {
        if (change.ref !== undefined) created.set(change.ref, change.name);
        return `Créer le pôle ${quoted(change.name)}`;
      }
      case "rename_group": return `Renommer le pôle ${group(change.groupId)} en ${quoted(change.name)}`;
      case "delete_group": return `Supprimer le pôle ${group(change.groupId)}`;
      case "assign": return change.groupId === null
        ? `Retirer ${project(change.projectId)} de son pôle`
        : `Ranger ${project(change.projectId)} dans ${group(change.groupId)}`;
      case "link": {
        const label = cleanLabel(change.label ?? "");
        return `Relier ${project(change.a)} → ${project(change.b)}${label ? ` : ${quoted(label)}` : ""}`;
      }
      case "unlink": return `Délier ${project(change.a)} et ${project(change.b)}`;
      case "rename_family": return `Dans ${project(change.projectId)} : renommer ${quoted(FAMILY_LABEL[change.family])} en ${quoted(change.name)}`;
      case "move_module": return `Dans ${project(change.projectId)} : déplacer ${quoted(change.moduleId)} vers ${quoted(FAMILY_LABEL[change.family])}`;
    }
  });
}
