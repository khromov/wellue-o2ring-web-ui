// Regression tests for issues found in the adversarial review against the
// vendor implementations (ViHealth / Lepu SDK, O2 Insight Pro).

import { describe, expect, it } from 'vitest'
import { crc8 } from './protocol/crc8'
import { encodeOxyII, OxyIIDecoder } from './protocol/oxyii'
import { LegacyDecoder } from './protocol/legacy'
import { LegacySession, legacySettingDefs } from './devices/legacySession'
import { LivePoller } from './devices/live'
import { identifyModel, MODELS } from './devices/models'
import type { Transport } from './transport/types'
import { isUnfinalisedOxyIIFile, parseOxyIIFile } from './files/oxyiiFile'
import { parseLegacyFile } from './files/legacyFile'
import { recordingToCsv } from './files/csv'
import { feetInches, fmtHeight } from './ui/format'
import { makeOxyIIFile } from './files/oxyiiFile.test'
import { makeLegacyFile } from './files/legacyFile.test'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function legacyReply(payload: Uint8Array, pktNo = 0, status = 0): Uint8Array {
  const f = new Uint8Array(8 + payload.length)
  f.set([0x55, status, ~status & 0xff, pktNo & 0xff, pktNo >> 8, payload.length & 0xff, payload.length >> 8])
  f.set(payload, 7)
  f[f.length - 1] = crc8(f, 0, f.length - 1)
  return f
}

describe('decoders keep scanning past an incomplete false header (SDK hasResponse)', () => {
  it('OxyII', () => {
    const d = new OxyIIDecoder()
    const bogus = new Uint8Array([0xa5, 0x12, 0xed, 0x01, 0x00, 0x00, 0x04]) // claims 1024 B
    const real = encodeOxyII(0xe4, new Uint8Array([1, 2, 3, 4]), 5)
    const frames = d.push(new Uint8Array([...bogus, ...real]))
    expect(frames.map((f) => f.cmd)).toEqual([0xe4])
  })

  it('OxyII rejects absurd lengths outright', () => {
    const d = new OxyIIDecoder()
    const bogus = new Uint8Array([0xa5, 0x12, 0xed, 0x01, 0x00, 0xff, 0xff])
    expect(d.push(bogus)).toEqual([])
    expect(d.push(encodeOxyII(0xe1, undefined, 2)).map((f) => f.cmd)).toEqual([0xe1])
  })

  it('legacy', () => {
    const d = new LegacyDecoder()
    const bogus = new Uint8Array([0x55, 0x00, 0xff, 0x00, 0x00, 0x00, 0x04])
    const frames = d.push(new Uint8Array([...bogus, ...legacyReply(new Uint8Array([9]))]))
    expect(frames).toHaveLength(1)
    expect(frames[0].payload).toEqual(new Uint8Array([9]))
  })
})

/** Scripted legacy device: answers each write with the frames the script returns. */
function fakeLegacy(script: (cmd: number, pktNo: number) => Uint8Array[]): Transport {
  const t: Transport = {
    kind: 'ble',
    name: 'O2Ring 0001',
    onData: () => {},
    onDisconnect: () => {},
    async write(data) {
      const frames = script(data[1], data[3] | (data[4] << 8))
      setTimeout(() => frames.forEach((f) => t.onData(f)), 1)
    },
    async close() {},
  }
  return t
}

describe('legacy session matches replies by packet number', () => {
  it('drops a stale block reply instead of splicing it into the file', async () => {
    const file = Uint8Array.from({ length: 30 }, (_, i) => i)
    const t = fakeLegacy((cmd, pkt) => {
      if (cmd === 0x03) return [legacyReply(new Uint8Array([30, 0, 0, 0]))]
      if (cmd === 0x04) {
        const block = legacyReply(file.slice(pkt * 10, pkt * 10 + 10), pkt)
        // Before block 2, a late duplicate of block 1 arrives.
        return pkt === 2 ? [legacyReply(file.slice(10, 20), 1), block] : [block]
      }
      return [legacyReply(new Uint8Array(0))]
    })
    const s = new LegacySession(t, identifyModel('O2Ring 0001')!)
    const got = await s.readFile('20240101000000')
    expect(got).toEqual(file)
  })

  it('works with devices that always answer packet 0', async () => {
    const file = Uint8Array.from({ length: 20 }, (_, i) => 100 + i)
    const t = fakeLegacy((cmd, pkt) => {
      if (cmd === 0x03) return [legacyReply(new Uint8Array([20, 0, 0, 0]))]
      if (cmd === 0x04) return [legacyReply(file.slice(pkt * 10, pkt * 10 + 10), 0)]
      return [legacyReply(new Uint8Array(0))]
    })
    const s = new LegacySession(t, identifyModel('O2Ring 0001')!)
    expect(await s.readFile('x')).toEqual(file)
  })

  it('always sends READ_END, even when the size is rejected', async () => {
    const sent: number[] = []
    const t = fakeLegacy((cmd) => {
      sent.push(cmd)
      if (cmd === 0x03) return [legacyReply(new Uint8Array([0, 0, 0, 0]))]
      return [legacyReply(new Uint8Array(0))]
    })
    const s = new LegacySession(t, identifyModel('O2Ring 0001')!)
    await expect(s.readFile('x')).rejects.toThrow(/size/)
    expect(sent).toEqual([0x03, 0x05])
  })
})

describe('LivePoller', () => {
  it('never runs two loops after a quick stop/start', async () => {
    let polls = 0
    const p = new LivePoller(async () => (polls++, null), () => false, 40)
    p.start(() => {})
    await sleep(350)
    void p.stop()
    p.start(() => {})
    const before = polls
    await sleep(800)
    const rate = (polls - before) / 0.8
    await p.stop()
    // One loop at 40 ms is ~25/s (minus the 300 ms start delay); two would be ~50/s.
    expect(rate).toBeLessThan(32)
    expect(polls - before).toBeGreaterThan(3)
  })

  it('pauses around exclusive work and resumes afterwards', async () => {
    let polls = 0
    const p = new LivePoller(async () => (polls++, null), () => false, 20)
    p.start(() => {})
    await sleep(400)
    let during = -1
    await p.exclusive(async () => {
      const n = polls
      await sleep(200)
      during = polls - n
    })
    expect(during).toBe(0)
    const after = polls
    await sleep(500)
    expect(polls).toBeGreaterThan(after)
    await p.stop()
  })
})

describe('file parsing fixes', () => {
  it('a finished O2Ring S file cut short is not mistaken for a recording in progress', () => {
    const buf = makeOxyIIFile(Array.from({ length: 100 }, () => [97, 60, 0] as [number, number, number]))
    const cut = buf.slice(0, buf.length - 21)
    expect(isUnfinalisedOxyIIFile(cut)).toBe(false)
  })

  it('a recording in progress uses the device interval hint', () => {
    const buf = new Uint8Array(10 + 3 * 5)
    buf[0] = 1
    buf[1] = 3
    buf.fill(97, 10)
    const r = parseOxyIIFile(buf, '20260928232310', 4)
    expect(r.interval).toBe(4)
    expect(r.spo2).toHaveLength(5)
  })

  it('legacy PR reminder is bit 0x40 only (0x20 is the motion reminder)', () => {
    const r = parseLegacyFile(
      makeLegacyFile([
        [97, 60, 0, 0x20],
        [97, 60, 0, 0x40],
      ]),
    )
    expect(r.prAlarm).toEqual([false, true])
  })

  it('CSV exports raw values like O2 Insight Pro (legacy motion 255 stays 255)', () => {
    const r = parseLegacyFile(makeLegacyFile([[0, 0, 255, 0]]))
    expect(recordingToCsv(r).split('\n')[1]).toMatch(/",0,0,255,0,0,$/)
  })
})

describe('device catalogue and settings fixes', () => {
  it.each([
    ['O2 Intg 0001', 'O2 Intg'],
    ['O2S 1234', 'O2S'],
    ['O2R WAVE 12', 'O2R WAVE'],
    ['O2 5C3D', 'Checkme O2'],
  ])('%s', (name, model) => {
    expect(identifyModel(name)?.name).toBe(model)
  })

  it('Oxyfit reminder is a sound switch (on = 2)', () => {
    const oxyfit = MODELS.find((m) => m.id === 20)!
    const on = legacySettingDefs({ OxiSwitch: '2', SoftwareVer: '1.4.12' }, oxyfit).find((d) => d.key === 'oxiReminder')!
    const off = legacySettingDefs({ OxiSwitch: '1', SoftwareVer: '1.4.12' }, oxyfit).find((d) => d.key === 'oxiReminder')!
    expect(on.value).toBe(1)
    expect(off.value).toBe(0)
    // Old firmware (< 1.4.10, compared digit-wise like ViHealth) treats any non-zero as on.
    const old = legacySettingDefs({ OxiSwitch: '1', SoftwareVer: '1.3.0' }, oxyfit).find((d) => d.key === 'oxiReminder')!
    expect(old.value).toBe(1)
  })

  it('SleepU reminder follows the motor strength', () => {
    const sleepu = MODELS.find((m) => m.id === 6)!
    const defs = legacySettingDefs({ CurMotor: '0', OxiSwitch: '1' }, sleepu)
    expect(defs.find((d) => d.key === 'oxiReminder')!.value).toBe(0)
  })

  it('imperial heights never show 12 inches', () => {
    expect(feetInches(182)).toEqual({ ft: 6, inch: 0 })
    expect(fmtHeight(152, 'imperial')).toBe('5 ft 0 in')
  })
})
