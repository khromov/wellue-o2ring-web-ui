// OxyII ("O2Ring S" generation) frame codec.
//
//   A5 | cmd | ~cmd | flag | seq | len_lo | len_hi | payload[len] | crc8
//
// flag: 0x00 host->device, 0x01 device->host. The device echoes seq.
// CRC-8 (poly 0x07) over every byte before the CRC.

import { crc8 } from './crc8'

export const OXYII_HEAD = 0xa5
export const OXYII_OVERHEAD = 8

export interface OxyIIFrame {
  cmd: number
  flag: number
  seq: number
  payload: Uint8Array
}

export function encodeOxyII(cmd: number, payload: Uint8Array = new Uint8Array(0), seq = 0): Uint8Array {
  if (payload.length >= 0x10000) throw new Error('payload too large')
  const out = new Uint8Array(OXYII_OVERHEAD + payload.length)
  out[0] = OXYII_HEAD
  out[1] = cmd & 0xff
  out[2] = ~cmd & 0xff
  out[3] = 0x00
  out[4] = seq & 0xff
  out[5] = payload.length & 0xff
  out[6] = (payload.length >> 8) & 0xff
  out.set(payload, 7)
  out[out.length - 1] = crc8(out, 0, out.length - 1)
  return out
}

/** Accumulates a byte stream and yields complete, CRC-valid frames. */
export class OxyIIDecoder {
  private buf = new Uint8Array(0)
  /** Bytes dropped while resyncing (for diagnostics). */
  dropped = 0

  push(chunk: Uint8Array): OxyIIFrame[] {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf)
    merged.set(chunk, this.buf.length)
    this.buf = merged

    const frames: OxyIIFrame[] = []
    let i = 0
    while (this.buf.length - i >= OXYII_OVERHEAD) {
      const b = this.buf
      if (b[i] !== OXYII_HEAD || ((b[i + 1] ^ b[i + 2]) & 0xff) !== 0xff) {
        i++
        this.dropped++
        continue
      }
      const len = b[i + 5] | (b[i + 6] << 8)
      const total = OXYII_OVERHEAD + len
      if (this.buf.length - i < total) break
      if (crc8(b, i, i + total - 1) !== b[i + total - 1]) {
        i++
        this.dropped++
        continue
      }
      frames.push({
        cmd: b[i + 1],
        flag: b[i + 3],
        seq: b[i + 4],
        payload: b.slice(i + 7, i + 7 + len),
      })
      i += total
    }
    this.buf = this.buf.slice(i)
    return frames
  }

  reset(): void {
    this.buf = new Uint8Array(0)
  }
}
