export function hex(data: Uint8Array | number[], sep = ' '): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(sep)
}

export function fromHex(s: string): Uint8Array {
  const clean = s.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function u16le(d: Uint8Array, o: number): number {
  return d[o] | (d[o + 1] << 8)
}

export function u32le(d: Uint8Array, o: number): number {
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0
}

export function i16le(d: Uint8Array, o: number): number {
  const v = u16le(d, o)
  return v & 0x8000 ? v - 0x10000 : v
}

export function latin1(d: Uint8Array, o: number, n: number): string {
  let s = ''
  for (let i = o; i < o + n && i < d.length; i++) {
    if (d[i] === 0) break
    s += String.fromCharCode(d[i])
  }
  return s
}

export function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}
