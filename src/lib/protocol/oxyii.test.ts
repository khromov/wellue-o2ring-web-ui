import { describe, expect, it } from 'vitest'
import { fromHex, hex } from './bytes'
import { crc8 } from './crc8'
import { encodeOxyII, OxyIIDecoder } from './oxyii'

// GET_INFO reply captured from a real O2Ring S over USB (HANDOFF.md).
const INFO_PAYLOAD = fromHex(`
42 00 05 00 01 02 00 00 00 32 44 30 31 30 30 30 31 01 40 08 52 16 01 00
ea 07 09 1c 16 0f 07 e0 07 00 00 00 00 0a 32 36 33 32 33 30 30 35 34 31
00 00 00 00 00 00 00 00 00 00 00 00`)

describe('crc8', () => {
  it('matches the public doc fixture', () => {
    expect(crc8(fromHex('A5 E1 1E 00 02 00 00'))).toBe(0xbf)
  })
})

describe('encodeOxyII', () => {
  it('builds the GET_INFO request that the ring answered', () => {
    expect(hex(encodeOxyII(0xe1, undefined, 1))).toBe('a5 e1 1e 00 01 00 00 02')
  })
})

describe('OxyIIDecoder', () => {
  const reply = (() => {
    const f = new Uint8Array(7 + INFO_PAYLOAD.length + 1)
    f.set(fromHex('A5 E1 1E 01 01 3C 00'))
    f.set(INFO_PAYLOAD, 7)
    f[f.length - 1] = crc8(f, 0, f.length - 1)
    return f
  })()

  it('reassembles a frame split across chunks', () => {
    const d = new OxyIIDecoder()
    expect(d.push(reply.slice(0, 63))).toEqual([])
    const frames = d.push(reply.slice(63))
    expect(frames).toHaveLength(1)
    expect(frames[0].cmd).toBe(0xe1)
    expect(frames[0].flag).toBe(1)
    expect(frames[0].seq).toBe(1)
    expect(frames[0].payload).toEqual(INFO_PAYLOAD)
  })

  it('resyncs past garbage and bad CRCs', () => {
    const d = new OxyIIDecoder()
    const bad = reply.slice()
    bad[20] ^= 0xff
    const frames = d.push(new Uint8Array([0x00, 0xa5, 0x12, ...bad, ...reply]))
    expect(frames).toHaveLength(1)
    expect(frames[0].payload).toEqual(INFO_PAYLOAD)
  })
})
