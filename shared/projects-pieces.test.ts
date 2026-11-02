import { describe, expect, it } from "vitest";

import {
  BUILD_KINDS, CARD_KINDS, FLOW_COLUMNS, PIECE_DEFAULT_TEXT, PIECE_KEY_PATTERN, PIECE_KINDS, PIECE_LABELS, externalPhrase, pieceKey,
} from "./projects-pieces.ts";

describe("piece words", () => {
  it("says each piece in plain words, the same table for the app and the Cartographe", () => {
    expect(PIECE_LABELS.ui.fr).toBe("Site ou appli");
    expect(PIECE_LABELS.api.fr).toBe("Serveur");
    expect(PIECE_LABELS.jobs.fr).toBe("Tâches automatiques");
    expect(PIECE_LABELS.tests.fr).toBe("Vérifications");
    for (const kind of PIECE_KINDS) {
      expect(PIECE_DEFAULT_TEXT[kind].fr.length).toBeGreaterThan(0);
      expect(PIECE_DEFAULT_TEXT[kind].en.length).toBeGreaterThan(0);
    }
  });

  it("puts every kind in exactly one column or in the build row, and keeps tests and deploy off the card", () => {
    const placed = [...FLOW_COLUMNS.flatMap((c) => c.kinds), ...BUILD_KINDS];
    expect([...placed].sort()).toEqual([...PIECE_KINDS].sort());
    expect(FLOW_COLUMNS.map((c) => c.id)).toEqual(["see", "work", "store", "outside"]);
    expect(CARD_KINDS).toEqual(["ui", "chatbot", "api", "jobs", "database", "cache", "external"]);
  });
});

describe("pieceKey", () => {
  it("is the kind, or external:<Tech> for an outside service", () => {
    expect(pieceKey({ kind: "api", tech: "Express" })).toBe("api");
    expect(pieceKey({ kind: "external", tech: "Stripe" })).toBe("external:Stripe");
    expect(pieceKey({ kind: "external", tech: "" })).toBe("external");
  });

  it("the key pattern takes every kind and an outside service's name, nothing else", () => {
    for (const kind of PIECE_KINDS) expect(PIECE_KEY_PATTERN.test(kind)).toBe(true);
    expect(PIECE_KEY_PATTERN.test("external:Stripe")).toBe(true);
    expect(PIECE_KEY_PATTERN.test("external:")).toBe(false);
    expect(PIECE_KEY_PATTERN.test("external:a\nb")).toBe(false);
    expect(PIECE_KEY_PATTERN.test(`external:${"a".repeat(41)}`)).toBe(false);
    expect(PIECE_KEY_PATTERN.test("server")).toBe(false);
    expect(PIECE_KEY_PATTERN.test("__proto__")).toBe(false);
  });
});

describe("externalPhrase", () => {
  it("says what the server does with each known service, and « utilise » otherwise", () => {
    expect(externalPhrase("Stripe", "fr")).toBe("encaisse les paiements avec");
    expect(externalPhrase("SendGrid", "fr")).toBe("envoie les e-mails avec");
    expect(externalPhrase("Nodemailer", "fr")).toBe("envoie les e-mails avec");
    expect(externalPhrase("Twilio", "fr")).toBe("envoie les SMS avec");
    expect(externalPhrase("OpenAI", "fr")).toBe("demande à l'IA de");
    expect(externalPhrase("AWS", "fr")).toBe("utilise");
    expect(externalPhrase("Firebase", "en")).toBe("uses");
  });
});
