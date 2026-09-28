import { describe, expect, it } from 'vitest'
import { fromHex, hex } from './bytes'
import { encodeOxyII } from './oxyii'
import {
  aesDecrypt,
  aesEncrypt,
  authPayload,
  fileNamePayload,
  parseAuthReply,
  parseBattery,
  parseConfig,
  parseFileList,
  parseInfo,
  parseRtData,
  setConfigPayload,
  timePayload,
  u32Payload,
  xorLepu,
} from './oxyiiMessages'

const INFO_PAYLOAD = fromHex(`
42 00 05 00 01 02 00 00 00 32 44 30 31 30 30 30 31 01 40 08 52 16 01 00
ea 07 09 1c 16 0f 07 e0 07 00 00 00 00 0a 32 36 33 32 33 30 30 35 34 31
00 00 00 00 00 00 00 00 00 00 00 00`)

describe('known-answer frames (seq 0)', () => {
  it.each([
    [0xe1, '', 'a5 e1 1e 00 00 00 00 69'],
    [0xe4, '', 'a5 e4 1b 00 00 00 00 09'],
    [0x00, '', 'a5 00 ff 00 00 00 00 b8'],
    [0xf1, '', 'a5 f1 0e 00 00 00 00 c5'],
    [0x04, '', 'a5 04 fb 00 00 00 00 93'],
    [0x10, '00', 'a5 10 ef 00 00 01 00 00 07'],
    [0xf4, '', 'a5 f4 0b 00 00 00 00 a5'],
  ])('cmd %i', (cmd, payload, expected) => {
    expect(hex(encodeOxyII(cmd, fromHex(payload), 0))).toBe(expected)
  })

  it('READ_FILE_START', () => {
    expect(hex(encodeOxyII(0xf2, fileNamePayload('20260928221507'), 0))).toBe(
      'a5 f2 0d 00 00 14 00 32 30 32 36 30 39 32 38 32 32 31 35 30 37 00 00 00 00 00 00 3f',
    )
  })

  it('READ_FILE_DATA', () => {
    expect(hex(encodeOxyII(0xf3, u32Payload(0x800), 0))).toBe('a5 f3 0c 00 00 04 00 00 08 00 00 33')
  })

  it('SET_UTC_TIME', () => {
    // 2026-09-28 22:15:07 at UTC+2 -> tz byte 20
    const d = new Date(2026, 8, 28, 22, 15, 7)
    const p = timePayload(d)
    expect(hex(p.slice(0, 7))).toBe('ea 07 09 1c 16 0f 07')
    expect(p[7]).toBe(((-d.getTimezoneOffset() / 6) & 0xff) >>> 0)
    const fixed = p.slice()
    fixed[7] = 20
    expect(hex(encodeOxyII(0xc0, fixed, 0))).toBe('a5 c0 3f 00 00 08 00 ea 07 09 1c 16 0f 07 14 3a')
  })

  it('AUTH token for ts = 1790000000 (0x6AB13B80, u32 LE like O2 Insight Pro)', () => {
    const p = authPayload(1790000000)
    expect(hex(xorLepu(p))).toBe('c2 cf da d8 a8 f7 c4 35 30 30 30 30 80 3b b1 6a')
    expect(hex(p)).toBe('00 68 15 88 72 09 1c b0 98 c8 c7 da 44 78 84 99')
  })

  it('AUTH frame matches a Windows O2 Insight Pro USB capture (SomnoTrace #177, ts 1788095920)', () => {
    expect(hex(encodeOxyII(0xff, authPayload(1788095920), 0))).toBe(
      'a5 ff 00 00 00 10 00 00 68 15 88 72 09 1c b0 98 c8 c7 da 74 6e a1 99 25',
    )
  })

  it('SET_CONFIG payload', () => {
    expect(hex(setConfigPayload(2, 90))).toBe('02 00 00 00 5a 00 00 00')
  })
})

describe('parsers', () => {
  it('GET_INFO from real O2Ring S', () => {
    const i = parseInfo(INFO_PAYLOAD)
    expect(i.hwVersion).toBe('B')
    expect(i.fwVersion).toBe('1.0.5.0')
    expect(i.bootloaderVersion).toBe('0.0.0.2')
    expect(i.branchCode).toBe('2D010001')
    expect(i.fileVersion).toBe(1)
    expect(i.protocolVersion).toBe('1.0')
    expect(i.deviceTime).toBe('2026-09-28 22:15:07')
    expect(i.sn).toBe('2632300541')
    expect(i.extra.maxPacketLength).toBe(2016)
  })

  it('GET_BATTERY', () => {
    expect(parseBattery(fromHex('01 44 7a 0f'))).toEqual({ state: 'charging', percent: 68, mV: 3962 })
  })

  it('GET_FILE_LIST', () => {
    const d = new Uint8Array(1 + 32)
    d[0] = 2
    d.set(new TextEncoder().encode('20260927230102'), 1)
    d.set(new TextEncoder().encode('20260928221507'), 17)
    expect(parseFileList(d)).toEqual(['20260927230102', '20260928221507'])
  })

  it('GET_CONFIG', () => {
    const c = parseConfig(fromHex('31 58 32 78 14 14 00 02 04 14 00 03 00 00 00 00 00 00 00 00'))
    expect(c.spo2Vibrate).toBe(true)
    expect(c.spo2Sound).toBe(false)
    expect(c.hrVibrate).toBe(true)
    expect(c.hrSound).toBe(true)
    expect(c.spo2Low).toBe(88)
    expect(c.hrLow).toBe(50)
    expect(c.hrHigh).toBe(120)
    expect(c.interval).toBe(4)
  })

  it('RT_DATA', () => {
    const d = new Uint8Array(20 + 6 + 5)
    d[4] = 2 // measuring
    d[5] = 1 // sensor ok
    d[6] = 97
    d[7] = 25 // PI 2.5
    d[8] = 62
    d[11] = 3
    d[12] = 1
    d[13] = 80
    d[24] = 5 // wave n
    d.set([10, 20, 156, 40, 50], 26)
    const s = parseRtData(d, 0)
    expect(s.spo2).toBe(97)
    expect(s.pr).toBe(62)
    expect(s.pi).toBe(2.5)
    expect(s.motion).toBe(3)
    expect(s.battery).toBe(80)
    expect(s.batteryState).toBe('charging')
    expect(s.sensor).toBe('ok')
    expect(s.wave).toEqual([10, 20, 30, 40, 50])
  })

  it('RT_DATA with invalid values', () => {
    const d = new Uint8Array(20)
    d[6] = 127
    d[8] = 0xff
    const s = parseRtData(d, 0)
    expect(s.spo2).toBeNull()
    expect(s.pr).toBeNull()
    expect(s.sensor).toBe('no-finger')
  })
})

describe('AES session', () => {
  it('parses an auth reply and round-trips ECB/PKCS7', () => {
    const key = fromHex('00112233445566778899aabbccddeeff')
    const reply = xorLepu(new Uint8Array([1, 16, 0, 0, ...key]))
    expect(parseAuthReply(reply)).toEqual(key)
    // 16-byte non-key replies and wrong type bytes are ignored (stay plaintext).
    expect(parseAuthReply(reply.slice(0, 16))).toBeNull()
    expect(parseAuthReply(xorLepu(new Uint8Array([2, 16, 0, 0, ...key])))).toBeNull()
    const enc = aesEncrypt(key, new Uint8Array([0]))
    expect(enc.length).toBe(16)
    expect(aesDecrypt(key, enc)).toEqual(new Uint8Array([0]))
  })
})
