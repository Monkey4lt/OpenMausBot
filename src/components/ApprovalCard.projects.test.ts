import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Bot, Message } from "@/state/store";
import { ApprovalCard } from "./ApprovalCard";
import { pendingApprovals, PendingApprovalPanel } from "./PendingApproval";

/** The card server/projects-hold.ts posts for the Cartographe's batch. */
const projectsCard = (lines: string[], answered?: string): Message => ({
  id: "projects-card", role: "bot", kind: "options", at: 1,
  card: {
    title: `Appliquer ces ${lines.length} changements à la carte ?`,
    subtitle: lines.join("\n"),
    options: ["Allow", "Deny"],
    requestId: "req-projects",
    tool: "projects_apply_changes",
    answered,
    outboundRequest: { tool: "projects_apply_changes", app: null, calls: lines.map((label) => ({ app: null, label })) },
  },
});
const bot = { id: "carto", name: "Cartographe" } as never as Bot;
const lines = ["Créer le pôle Clients", "Ranger shop dans Clients"];

describe("the Cartographe's card", () => {
  it("asks to apply the changes to the map and lists them, never 'Send on your behalf'", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message: projectsCard(lines) }));
    expect(html).toContain("Apply these 2 changes to the map?");
    expect(html).toContain("Créer le pôle Clients, Ranger shop dans Clients");
    expect(html).not.toContain("Send on your behalf");
    expect(html).not.toContain("projects_apply_changes");
  });

  it("settles into one line with the outcome", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message: projectsCard(lines, "allow") }));
    expect(html).toContain('data-approval-row="settled"');
    expect(html).toContain("Apply these 2 changes to the map");
    expect(html).toContain("· Allowed");
  });

  it("heads the composer strip the same way", () => {
    const [pending] = pendingApprovals([projectsCard(lines)]);
    const strip = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0 }));
    expect(strip).toContain("Apply these 2 changes to the map?");
    expect(strip).not.toContain("Send on your behalf");
  });
});
