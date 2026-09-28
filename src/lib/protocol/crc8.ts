// CRC-8, poly 0x07, init 0, no reflection, no xorout.
// Byte-identical to the table in O2 Insight Pro (CommPkg::crc8Table).

const TABLE = (() => {
  const t = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff
    t[i] = c
  }
  return t
})()

export function crc8(data: Uint8Array, start = 0, end = data.length): number {
  let crc = 0
  for (let i = start; i < end; i++) crc = TABLE[(crc ^ data[i]) & 0xff]
  return crc
}
