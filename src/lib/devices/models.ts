// Device catalogue. Identification is by BLE advertised name, mirroring
// Bluetooth.getDeviceModel() in the Lepu SDK: substring checks first (most
// specific first), then an exact match on the first space-separated token.

import type { GattProfile } from '../transport/ble'
import type { ProtocolFamily } from './types'

type Range = [min: number, max: number, step: number]

export interface DeviceModel {
  id: number
  name: string
  family: ProtocolFamily
  /** Advertised name contains one of these. */
  contains?: string[]
  /** First token of the advertised name equals one of these. */
  token?: string[]
  /** OxyII: whether the SDK sends the 0xFF auth frame. */
  oxyiiAuth?: boolean
  /** Settings UI shows a buzzer/volume option. */
  hasBuzzer?: boolean
  /** Legacy: the app ignores the RT lead-off bit for this model. */
  ignoreLead?: boolean
  /** Legacy: per-model setting ranges (O2SettingValueConfig). */
  legacyRanges?: { oxiThr?: Range; hrLow?: Range; hrHigh?: Range; motor?: number[] }
  /** Validated against real hardware by this project. */
  tested?: boolean
}

export const OXYII_GATT: GattProfile = {
  id: 'oxyii',
  service: 'e8fb0001-a14b-98f9-831b-4e2941d01248',
  write: 'e8fb0002-a14b-98f9-831b-4e2941d01248',
  notify: 'e8fb0003-a14b-98f9-831b-4e2941d01248',
}

export const LEGACY_GATT: GattProfile = {
  id: 'legacy',
  service: '14839ac4-7d7e-415c-9a42-167340cf2339',
  write: '8b00ace7-eb0b-49b0-bbe9-9aee0a26e1a3',
  notify: '0734594a-a8e7-4b1a-a6b1-cd5243059a57',
  chunkDelayMs: 20,
}

const BABY_MOTOR = [5, 10, 17, 22, 35]

/** FDA-cleared variants whose settings the vendor apps don't allow changing. */
export const READ_ONLY_BRANCH_CODES = new Set(['2D010004', '24010007', '24010009', '24010010'])

// Order matters for `contains`: more specific names first.
export const MODELS: DeviceModel[] = [
  // ---- OxyII (0xA5) devices
  { id: 227, name: 'O2RMed S', family: 'oxyii', contains: ['O2RMed S'], oxyiiAuth: false },
  { id: 219, name: 'O2Ring SF', family: 'oxyii', contains: ['O2Ring SF'] },
  { id: 221, name: 'O2Ring SP', family: 'oxyii', contains: ['O2Ring SP'] },
  { id: 226, name: 'O2Ring SC', family: 'oxyii', contains: ['O2Ring SC'] },
  { id: 124, name: 'O2Ring S', family: 'oxyii', contains: ['O2Ring S'], tested: true },
  { id: 144, name: 'S8-AW', family: 'oxyii', contains: ['S8-AW'] },
  { id: 175, name: 'Band-WU', family: 'oxyii', contains: ['Band-WU'], oxyiiAuth: false, hasBuzzer: true },
  { id: 180, name: 'SHQO2Pro', family: 'oxyii', contains: ['SHQO2Pro'] },
  { id: 220, name: 'O2MP', family: 'oxyii', contains: ['O2MP'] },
  // ---- Legacy (0xAA) devices
  { id: 203, name: 'O2RingF', family: 'legacy', contains: ['O2RingF'], ignoreLead: true },
  { id: 217, name: 'O2Ring-RE', family: 'legacy', contains: ['O2Ring-RE'], ignoreLead: true },
  { id: 4, name: 'O2Ring', family: 'legacy', contains: ['O2Ring'], ignoreLead: true },
  { id: 113, name: 'KidsO2', family: 'legacy', contains: ['KidsO2-WPS'], legacyRanges: { hrLow: [40, 70, 5], hrHigh: [70, 220, 5], motor: BABY_MOTOR } },
  { id: 112, name: 'Oxyfit', family: 'legacy', contains: ['Oxyfit-WPS'], legacyRanges: { hrLow: [30, 60, 5], hrHigh: [100, 200, 5] } },
  { id: 20, name: 'Oxyfit', family: 'legacy', contains: ['Oxyfit'], legacyRanges: { hrLow: [30, 60, 5], hrHigh: [100, 200, 5] } },
  { id: 101, name: 'Checkme O2 Max', family: 'legacy', contains: ['O2M-WPS'], legacyRanges: { hrLow: [40, 70, 5] } },
  { id: 225, name: 'OxyU SE', family: 'legacy', contains: ['OxyU SE'], ignoreLead: true },
  { id: 69, name: 'OxyU', family: 'legacy', contains: ['OxyU'], ignoreLead: true },
  { id: 64, name: 'Sleep Sock (BBSM S1)', family: 'legacy', contains: ['BBSM S1'], legacyRanges: { oxiThr: [80, 96, 2], motor: BABY_MOTOR } },
  // OEM rings the SDK drives with the legacy interface (not offered in ViHealth).
  { id: 233, name: 'O2 Intg', family: 'legacy', contains: ['O2 Intg'], ignoreLead: true },
  { id: 222, name: 'O2R WAVE', family: 'legacy', contains: ['O2R WAVE'], ignoreLead: true },
  { id: 170, name: 'O2S', family: 'legacy', token: ['O2S'], ignoreLead: true },
  { id: 11, name: 'KidsO2', family: 'legacy', token: ['KidsO2'], legacyRanges: { hrLow: [40, 70, 5], hrHigh: [70, 220, 5], motor: BABY_MOTOR } },
  { id: 2, name: 'SnoreO2', family: 'legacy', token: ['O2BAND'] },
  { id: 6, name: 'SleepU', family: 'legacy', token: ['SleepU'], ignoreLead: true },
  { id: 5, name: 'WearO2', family: 'legacy', token: ['WearO2'] },
  { id: 3, name: 'SleepO2', family: 'legacy', token: ['SleepO2'] },
  { id: 1, name: 'Checkme O2', family: 'legacy', token: ['O2'] },
  { id: 25, name: 'Checkme O2 Max', family: 'legacy', token: ['O2M'], legacyRanges: { hrLow: [40, 70, 5] } },
  { id: 48, name: 'Checkme O2 (NCI)', family: 'legacy', token: ['O2NCI'] },
  { id: 63, name: 'OxyRing', family: 'legacy', token: ['OxyRing'], ignoreLead: true },
  { id: 10, name: 'Oxylink', family: 'legacy', token: ['Oxylink'] },
  { id: 29, name: 'BabyO2 S2', family: 'legacy', token: ['BabyO2N'], legacyRanges: { oxiThr: [70, 96, 2], hrLow: [30, 110, 5], hrHigh: [110, 220, 5] } },
  { id: 13, name: 'BabyO2', family: 'legacy', token: ['BabyO2'], legacyRanges: { oxiThr: [80, 96, 2], hrLow: [30, 110, 5], hrHigh: [110, 220, 5], motor: BABY_MOTOR } },
]

export function identifyModel(name: string | undefined | null): DeviceModel | null {
  const n = (name ?? '').trim()
  if (!n) return null
  for (const m of MODELS) if (m.contains?.some((s) => n.includes(s))) return m
  const first = n.split(' ')[0]
  for (const m of MODELS) if (m.token?.includes(first)) return m
  return null
}

/** GATT profiles to try, in order, for a model. */
export function gattProfilesFor(model: DeviceModel | null): GattProfile[] {
  if (!model) return [LEGACY_GATT, OXYII_GATT]
  return model.family === 'oxyii' ? [OXYII_GATT] : [LEGACY_GATT, OXYII_GATT]
}

export function allGattServices(): BluetoothServiceUUID[] {
  return [OXYII_GATT.service, LEGACY_GATT.service]
}

/** Name-prefix filters for the Web Bluetooth chooser. */
export function bleNameFilters(): BluetoothLEScanFilter[] {
  const prefixes = new Set<string>()
  for (const m of MODELS) {
    for (const s of m.contains ?? []) prefixes.add(s)
    for (const s of m.token ?? []) prefixes.add(s)
  }
  // "O2" covers O2Ring*, O2M, O2NCI, O2BAND, O2MP and Checkme O2 ("O2 1234").
  const all = [...prefixes]
  return all.filter((p) => !all.some((q) => q !== p && p.startsWith(q))).map((namePrefix) => ({ namePrefix }))
}

/** Human-readable list for the UI. */
export function supportedNames(): { tested: string[]; untested: string[] } {
  const uniq = (xs: string[]) => [...new Set(xs)]
  return {
    tested: uniq(MODELS.filter((m) => m.tested).map((m) => m.name)),
    untested: uniq(MODELS.filter((m) => !m.tested).map((m) => m.name)),
  }
}
