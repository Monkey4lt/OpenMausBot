import { describe, expect, it } from "vitest";

import { readTar } from "./tar.ts";
import { pax, tar } from "./testing/tar-builder.ts";

const text = (files: { path: string; data: Uint8Array }[]) => files.map((f) => ({ path: f.path, data: new TextDecoder().decode(f.data) }));

describe("readTar", () => {
  it("reads a tar built in the test, with a long PAX path", () => {
    const long = `${"deep/".repeat(40)}file.ts`;
    const out = readTar(tar([
      { name: "a.ts", data: 'import "./b";' },
      { name: "PaxHeader", type: "x", data: pax({ path: long, mtime: "1" }) },
      { name: "truncated-name", data: "x".repeat(600) },
    ]));
    expect(text(out)).toEqual([{ path: "a.ts", data: 'import "./b";' }, { path: long, data: "x".repeat(600) }]);
  });

  it("PAX record lengths count bytes, so a multibyte path is read whole", () => {
    const long = `${"é/".repeat(60)}ü.ts`;
    const out = readTar(tar([
      { name: "PaxHeader", type: "x", data: pax({ path: long, comment: "ça" }) },
      { name: "short", data: "x" },
      { name: "b.ts", data: "b" },
    ]));
    expect(text(out)).toEqual([{ path: long, data: "x" }, { path: "b.ts", data: "b" }]);
  });

  it("joins the ustar prefix and the name", () => {
    expect(text(readTar(tar([{ name: "c.ts", prefix: "repo/src/lib", data: "c" }])))).toEqual([{ path: "repo/src/lib/c.ts", data: "c" }]);
  });

  it("reads GNU long names", () => {
    const long = `${"g/".repeat(80)}long.ts`;
    expect(text(readTar(tar([{ name: "././@LongLink", type: "L", data: `${long}\0` }, { name: "short", data: "g" }])))).toEqual([{ path: long, data: "g" }]);
  });

  it("a global PAX header does not rename the next file", () => {
    expect(text(readTar(tar([{ name: "pax_global_header", type: "g", data: pax({ comment: "sha" }) }, { name: "a.ts", data: "a" }])))).toEqual([{ path: "a.ts", data: "a" }]);
  });

  it("ignores directories and symlinks", () => {
    const out = readTar(tar([
      { name: "dir/", type: "5" },
      { name: "link.ts", type: "2", linkname: "/etc/passwd" },
      { name: "hard.ts", type: "1", linkname: "a.ts" },
      { name: "fifo", type: "6" },
      { name: "a.ts", data: "a" },
      { name: "old.ts", type: "\0", data: "o" },
    ]));
    expect(text(out)).toEqual([{ path: "a.ts", data: "a" }, { path: "old.ts", data: "o" }]);
  });

  it("stops at two zero blocks", () => {
    const archive = tar([{ name: "a.ts", data: "a" }]);
    const trailing = tar([{ name: "after.ts", data: "x" }]);
    const both = new Uint8Array(archive.length + trailing.length);
    both.set(archive); both.set(trailing, archive.length);
    expect(text(readTar(both))).toEqual([{ path: "a.ts", data: "a" }]);
  });

  it("an archive without end blocks still gives its files", () => {
    expect(text(readTar(tar([{ name: "a.ts", data: "a" }], 0)))).toEqual([{ path: "a.ts", data: "a" }]);
  });

  it("a size that points past the end of the archive is an error", () => {
    const bad = tar([{ name: "a.ts", data: "a", size: 10_000 }], 0);
    expect(() => readTar(bad)).toThrow("Broken tar archive: a.ts claims 10000 bytes past the end");
  });

  it("a header with a bad checksum is an error", () => {
    const bad = tar([{ name: "a.ts", data: "a" }]);
    bad[0] = "b".charCodeAt(0);
    expect(() => readTar(bad)).toThrow("Broken tar archive: bad header checksum");
  });

  it("an empty buffer has no files", () => {
    expect(readTar(new Uint8Array(0))).toEqual([]);
  });
});
