import { describe, expect, it } from "vitest";

import {
  MAX_ANNOTATIONS, MAX_INK_POINTS, MAX_NOTE_CHARS, STICKY_COLORS, annotationBounds, cleanAnnotation, cleanAnnotations, cleanNoteText,
} from "./model";

const sticky = { id: "n1", kind: "sticky", x: 10, y: 20, w: 160, h: 120, text: "Penser à la démo", color: "warning" };
const text = { id: "t1", kind: "text", x: 0, y: 0, text: "Titre", size: "l" };
const shape = { id: "s1", kind: "shape", shape: "diamond", x: 5, y: 5, w: 40, h: 30 };
const ink = { id: "i1", kind: "ink", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };

describe("canvas annotation model", () => {
  it("keeps a valid note, text, shape and stroke as they are", () => {
    expect(cleanAnnotation(sticky)).toEqual(sticky);
    expect(cleanAnnotation(text)).toEqual(text);
    expect(cleanAnnotation(shape)).toEqual(shape);
    expect(cleanAnnotation(ink)).toEqual(ink);
    expect([MAX_ANNOTATIONS, MAX_NOTE_CHARS, MAX_INK_POINTS]).toEqual([500, 2000, 2000]);
  });

  it("drops unknown fields", () => {
    expect(cleanAnnotation({ ...shape, evil: "<script>" })).toEqual(shape);
  });

  it("rejects what is not an annotation", () => {
    for (const bad of [null, "x", 3, [], {}, { ...sticky, kind: "video" }, { ...sticky, id: "" }, { ...sticky, id: 7 }, { ...shape, shape: "star" },
      { ...sticky, w: 0 }, { ...sticky, h: -4 }, { ...text, text: 5 }, { ...ink, points: [{ x: 1, y: 1 }] }, { ...ink, points: "nope" },
      { ...sticky, id: "x".repeat(65) }]) {
      expect(cleanAnnotation(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("rejects NaN and Infinity coordinates", () => {
    expect(cleanAnnotation({ ...sticky, x: Number.NaN })).toBeNull();
    expect(cleanAnnotation({ ...shape, w: Number.POSITIVE_INFINITY })).toBeNull();
    expect(cleanAnnotation({ ...text, y: "12" })).toBeNull();
    expect(cleanAnnotation({ ...ink, points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 5, y: 5 }] })).toEqual({ ...ink, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] });
  });

  it("falls back to a default note colour and text size", () => {
    expect(cleanAnnotation({ ...sticky, color: "#ff00ff" })).toMatchObject({ color: STICKY_COLORS[0] });
    expect(cleanAnnotation({ ...text, size: "xxl" })).toMatchObject({ size: "m" });
  });

  it("cuts a 10 000-char note to 2 000", () => {
    const note = cleanAnnotation({ ...sticky, text: "a".repeat(10_000) });
    expect(note && "text" in note ? note.text.length : 0).toBe(2000);
  });

  it("removes control characters but keeps line breaks", () => {
    expect(cleanNoteText("a\u0000b\u0007c\r\nd\re\tf\u001bg\u007fh‮i\n")).toBe("abc\nd\ne fgh" + "i\n");
    const note = cleanAnnotation({ ...text, text: "x\u0000\u0001y\nz" });
    expect(note).toMatchObject({ text: "xy\nz" });
  });

  it("never cuts a surrogate pair in half", () => {
    const out = cleanNoteText("a" + "😀".repeat(1500));
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false);
  });

  it("brings 600 annotations down to 500", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ ...shape, id: `s${i}` }));
    const out = cleanAnnotations(many);
    expect(out).toHaveLength(500);
    expect(out[499].id).toBe("s499");
  });

  it("removes duplicate ids, keeping the first one", () => {
    const out = cleanAnnotations([sticky, { ...shape, id: "n1" }, text, "junk", null]);
    expect(out.map((a) => a.id)).toEqual(["n1", "t1"]);
    expect(out[0].kind).toBe("sticky");
    expect(cleanAnnotations("not a list")).toEqual([]);
  });

  it("simplifies a 5 000-point stroke, then caps it", () => {
    const straight = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: 0 }));
    expect(cleanAnnotation({ ...ink, points: straight })).toEqual({ ...ink, points: [{ x: 0, y: 0 }, { x: 4999, y: 0 }] });

    const jagged = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: i % 2 === 0 ? 0 : 40 }));
    const out = cleanAnnotation({ ...ink, points: jagged });
    const points = out && out.kind === "ink" ? out.points : [];
    expect(points.length).toBeLessThanOrEqual(2000);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 4999, y: 40 });
  });

  it("annotationBounds gives a box for every kind", () => {
    expect(annotationBounds(cleanAnnotation(sticky)!)).toEqual({ x: 10, y: 20, w: 160, h: 120 });
    expect(annotationBounds(cleanAnnotation(ink)!)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    const box = annotationBounds(cleanAnnotation(text)!);
    expect(box.x).toBe(0);
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
    const longer = annotationBounds(cleanAnnotation({ ...text, text: "Titre beaucoup plus long" })!);
    expect(longer.w).toBeGreaterThan(box.w);
  });
});
