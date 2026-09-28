import { describe, expect, it } from 'vitest'
import { crc8 } from './crc8'
import { fromHex, hex } from './bytes'
import {
  LegacyDecoder,
  encodeLegacy,
  legacyFileList,
  legacyTimeString,
  paraSyncPayload,
  parseLegacyInfo,
  parseLegacyRtParam,
  readStartPayload,
} from './legacy'

describe('legacy 0xAA packets (known answers from the Lepu SDK notes)', () => {
  it.each([
    [0x14, '', 0, 'aa 14 eb 00 00 00 00 c6'],
    [0x15, '', 0, 'aa 15 ea 00 00 00 00 8d'],
    [0x17, '', 0, 'aa 17 e8 00 00 00 00 1b'],
    [0x1b, '00', 0, 'aa 1b e4 00 00 01 00 00 5e'],
    [0x04, '', 0, 'aa 04 fb 00 00 00 00 6a'],
    [0x04, '', 1, 'aa 04 fb 01 00 00 00 7c'],
    [0x05, '', 0, 'aa 05 fa 00 00 00 00 21'],
  ])('cmd 0x%s', (cmd, payload, pkt, expected) => {
    expect(hex(encodeLegacy(cmd, fromHex(payload), pkt))).toBe(expected)
  })

  it('READ_START with NUL-terminated name', () => {
    expect(hex(encodeLegacy(0x03, readStartPayload('20240101223000')))).toBe(
      'aa 03 fc 00 00 0f 00 32 30 32 34 30 31 30 31 32 32 33 30 30 30 00 ec',
    )
  })

  it('PARA_SYNC SetTIME', () => {
    const t = legacyTimeString(new Date(2026, 8, 28, 22, 30, 0))
    expect(t).toBe('2026-09-28,22:30:00')
    expect(hex(encodeLegacy(0x16, paraSyncPayload({ SetTIME: t })))).toBe(
      'aa 16 e9 00 00 21 00 7b 22 53 65 74 54 49 4d 45 22 3a 22 32 30 32 36 2d 30 39 2d 32 38 2c 32 32 3a 33 30 3a 30 30 22 7d a3',
    )
  })

  it('PARA_SYNC sends values as strings', () => {
    expect(new TextDecoder().decode(paraSyncPayload({ SetOxiThr: 88 }))).toBe('{"SetOxiThr":"88"}')
  })
})

function reply(status: number, payload: Uint8Array): Uint8Array {
  const f = new Uint8Array(8 + payload.length)
  f.set([0x55, status, ~status & 0xff, 0, 0, payload.length & 0xff, payload.length >> 8])
  f.set(payload, 7)
  f[f.length - 1] = crc8(f, 0, f.length - 1)
  return f
}

describe('LegacyDecoder', () => {
  it('reassembles 20-byte notifications into a JSON INFO reply', () => {
    const json = '{"SN":"1234567890","CurBAT":"85%","CurBatState":"1","FileList":"20240101223000,20240102221500,","CurOxiThr":"88"}'
    const f = reply(0, new TextEncoder().encode(json))
    const d = new LegacyDecoder()
    const frames = []
    for (let o = 0; o < f.length; o += 20) frames.push(...d.push(f.slice(o, o + 20)))
    expect(frames).toHaveLength(1)
    expect(frames[0].status).toBe(0)
    const info = parseLegacyInfo(frames[0].payload)
    expect(info.SN).toBe('1234567890')
    expect(legacyFileList(info)).toEqual(['20240101223000', '20240102221500'])
  })

  it('handles FileList wrapped in brackets and empty lists', () => {
    expect(legacyFileList({ FileList: '[20240101223000,20240102221500]' })).toEqual(['20240101223000', '20240102221500'])
    expect(legacyFileList({ FileList: '' })).toEqual([])
  })

  it('reports non-zero status', () => {
    const [f] = new LegacyDecoder().push(reply(1, new Uint8Array(0)))
    expect(f.status).toBe(1)
  })
})

describe('RT_PARAM', () => {
  it('parses values', () => {
    const r = parseLegacyRtParam(fromHex('61 3c 00 10 00 00 00 55 01 03 19 01'))!
    expect(r).toMatchObject({ spo2: 97, pr: 60, steps: 16, battery: 85, batteryState: 1, motion: 3, piRaw: 25, leadOn: true })
  })
  it('returns null for short payloads', () => {
    expect(parseLegacyRtParam(new Uint8Array(4))).toBeNull()
  })
})
