const BLOCK = 512;
const decoder = new TextDecoder();

export type TarFile = { path: string; data: Uint8Array };

function field(buf: Uint8Array, at: number, len: number): string {
  const slice = buf.subarray(at, at + len);
  const nul = slice.indexOf(0);
  return decoder.decode(nul < 0 ? slice : slice.subarray(0, nul));
}

function octal(buf: Uint8Array, at: number, len: number): number {
  if (buf[at] & 0x80) {
    let n = buf[at] & 0x7f;
    for (let i = 1; i < len; i++) n = n * 256 + buf[at + i];
    return n;
  }
  const text = field(buf, at, len).trim();
  return text ? parseInt(text, 8) : 0;
}

function checksumOk(header: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  return sum === octal(header, 148, 8);
}

function paxPath(data: Uint8Array): string | null {
  const text = decoder.decode(data);
  let at = 0;
  let path: string | null = null;
  while (at < text.length) {
    const space = text.indexOf(" ", at);
    const len = Number(text.slice(at, space));
    if (space < 0 || !Number.isInteger(len) || len <= 0) break;
    const record = text.slice(space + 1, at + len - 1);
    if (record.startsWith("path=")) path = record.slice(5);
    at += len;
  }
  return path;
}

const isZeroBlock = (buf: Uint8Array, at: number) => buf.subarray(at, at + BLOCK).every((b) => b === 0);

/** Regular files only (typeflag `0` or NUL); ustar prefix, PAX `path=` and GNU `L` long names are honoured. */
export function readTar(buf: Uint8Array): TarFile[] {
  const files: TarFile[] = [];
  let nextPath: string | null = null;
  let at = 0;
  while (at + BLOCK <= buf.length) {
    if (isZeroBlock(buf, at)) {
      if (at + 2 * BLOCK > buf.length || isZeroBlock(buf, at + BLOCK)) break;
      at += BLOCK;
      continue;
    }
    const header = buf.subarray(at, at + BLOCK);
    if (!checksumOk(header)) throw new Error("Broken tar archive: bad header checksum");
    const name = field(header, 0, 100);
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156]);
    const prefix = field(header, 257, 6) === "ustar" ? field(header, 345, 155) : "";
    const start = at + BLOCK;
    if (start + size > buf.length) throw new Error(`Broken tar archive: ${name} claims ${size} bytes past the end`);
    const data = buf.subarray(start, start + size);
    at = start + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") { nextPath = paxPath(data) ?? nextPath; continue; }
    if (type === "L") { nextPath = field(data, 0, data.length); continue; }
    if (type === "g") continue;
    const path = nextPath ?? (prefix ? `${prefix}/${name}` : name);
    nextPath = null;
    if (type === "0" || type === "\0") files.push({ path, data });
  }
  return files;
}
