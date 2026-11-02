export type Entry = { name: string; data?: string; type?: string; prefix?: string; linkname?: string; size?: number };

function header({ name, data = "", type = "0", prefix = "", linkname = "", size }: Entry): Uint8Array {
  const h = new Uint8Array(512);
  const put = (text: string, at: number, len: number) => h.set(new TextEncoder().encode(text).subarray(0, len), at);
  put(name, 0, 100);
  put("0000644\0", 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(`${(size ?? new TextEncoder().encode(data).length).toString(8).padStart(11, "0")}\0`, 124, 12);
  put("00000000000\0", 136, 12);
  put("        ", 148, 8);
  put(type, 156, 1);
  put(linkname, 157, 100);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  const sum = h.reduce((n, b) => n + b, 0);
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

function block(data: string): Uint8Array {
  const bytes = new TextEncoder().encode(data);
  const out = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
  out.set(bytes);
  return out;
}

export function tar(entries: Entry[], end = 2): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) parts.push(header(e), block(e.data ?? ""));
  for (let i = 0; i < end; i++) parts.push(new Uint8Array(512));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function pax(records: Record<string, string>): string {
  return Object.entries(records).map(([k, v]) => {
    const body = ` ${k}=${v}\n`;
    let len = body.length + 1;
    while (`${len}${body}`.length !== len) len = `${len}${body}`.length;
    return `${len}${body}`;
  }).join("");
}
