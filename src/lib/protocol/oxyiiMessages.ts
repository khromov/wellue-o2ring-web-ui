// OxyII command codes and payload (de)serializers.
// Source: Lepu BLE SDK embedded in ViHealth (OxyIIBleInterface, LpBleCmd,
// OxyIIBleCmd, OxyIIBleResponse, LepuDevice, OxyIIConfig), cross-checked
// against O2 Insight Pro and a real O2Ring S.

import { ecb } from '@noble/ciphers/aes.js'
import { latin1, u16le, u32le } from './bytes'
import type { BatteryInfo, BatteryState, DeviceInfo, LiveSample, SensorState } from '../devices/types'

export const Cmd = {
  GET_CONFIG: 0x00,
  SET_CONFIG: 0x01,
  RT_PARAM: 0x02,
  RT_WAVE: 0x03,
  RT_DATA: 0x04,
  AUTO_RT_SWITCH: 0x10,
  SET_UTC_TIME: 0xc0,
  SET_TIME: 0xec,
  ECHO: 0xe0,
  GET_INFO: 0xe1,
  GET_BATTERY: 0xe4,
  GET_FILE_LIST: 0xf1,
  READ_FILE_START: 0xf2,
  READ_FILE_DATA: 0xf3,
  READ_FILE_END: 0xf4,
  AUTH: 0xff,
} as const

/**
 * Opcodes this app is allowed to send. Everything else (factory reset 0xE3,
 * 0xEE, reset 0xE2, firmware 0xE5-E7, factory burn 0xEA/EB, file write
 * 0xF5-F7, delete 0xF8, DFU 0xFA) is refused at the session layer.
 */
export const ALLOWED_CMDS = new Set<number>(Object.values(Cmd))
/** Subset that changes device state; the UI must get user consent. */
export const WRITE_CMDS = new Set<number>([Cmd.SET_CONFIG, Cmd.SET_UTC_TIME, Cmd.SET_TIME])

/** Response pkgType values (frame byte 3). */
export const PKG_ERRORS: Record<number, string> = {
  0x02: 'CRC error',
  0xe0: 'file not found',
  0xe1: 'file read failed',
  0xe2: 'file write failed',
  0xe3: 'firmware update failed',
  0xe4: 'language update failed',
  0xf1: 'illegal parameter',
  0xf2: 'permission denied',
  0xf3: 'decrypt failed',
  0xfb: 'device busy',
  0xfc: 'command format error',
  0xfd: 'command not supported',
  0xff: 'error',
}

// ---------------------------------------------------------------- auth / AES

/** MD5("lepucloud") */
export const LEPU_KEY = new Uint8Array([
  0xc2, 0xa7, 0xcf, 0x50, 0xda, 0xfe, 0xd8, 0x85, 0xa8, 0xf8, 0xf7, 0xea, 0xc4, 0x43, 0x35, 0xf3,
])

/**
 * AUTH token: MD5("lepucloud")[0,2,..,14] + "0000" + u32 LE Unix time, XOR MD5.
 * O2 Insight Pro (macOS disassembly and Windows USB captures) packs the time
 * as u32 LE; ViHealth's Lepu SDK shifts by bits instead. The ring doesn't
 * appear to validate it; we follow the desktop app.
 */
export function authPayload(unixSeconds: number, id = '0000'): Uint8Array {
  const t = new Uint8Array(16)
  for (let i = 0; i < 8; i++) t[i] = LEPU_KEY[i * 2]
  for (let i = 0; i < 4; i++) t[8 + i] = id.charCodeAt(i) & 0xff
  for (let i = 0; i < 4; i++) t[12 + i] = Math.floor(unixSeconds / 2 ** (8 * i)) & 0xff
  return xorLepu(t)
}

export function xorLepu(d: Uint8Array): Uint8Array {
  return d.map((b, i) => b ^ LEPU_KEY[i % 16])
}

/**
 * Parse the 0xFF reply: XOR-decode, then [type, len, ?, ?, key[len]].
 * Only a >= 20-byte reply decoding to type 1 / length 16 is a key (as
 * O2 Insight Pro checks); some rings send 16-byte non-key replies and then
 * work in plaintext.
 */
export function parseAuthReply(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 20) return null
  const d = xorLepu(payload)
  if (d[0] !== 1 || d[1] !== 16) return null
  return d.slice(4, 20)
}

export function aesEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  return ecb(key).encrypt(data)
}

export function aesDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  return ecb(key).decrypt(data)
}

// ------------------------------------------------------------------- payloads

/** SET_UTC_TIME: local wall clock + UTC offset in tenths of an hour. */
export function timePayload(d: Date = new Date()): Uint8Array {
  const y = d.getFullYear()
  const tz = Math.trunc(-d.getTimezoneOffset() / 6) // minutes -> 0.1 h, truncated like Java int division
  return new Uint8Array([
    y & 0xff,
    y >> 8,
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    tz & 0xff,
  ])
}

/** SET_TIME 0xEC (O2 Insight Pro): year u16, month, day, hour, minute, second (local). */
export function timePayloadNoTz(d: Date = new Date()): Uint8Array {
  return timePayload(d).slice(0, 7)
}

export function fileNamePayload(name: string): Uint8Array {
  const out = new Uint8Array(20)
  const bytes = new TextEncoder().encode(name).slice(0, 16)
  out.set(bytes, 0)
  // bytes 16..19: u32 LE, always 0 in the vendor app
  return out
}

export function u32Payload(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])
}

// -------------------------------------------------------------------- parsers

function dotted(d: Uint8Array, o: number): string {
  return [d[o + 3], d[o + 2], d[o + 1], d[o]].join('.')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** GET_INFO 0xE1 (LepuDevice). Requires >= 38 bytes. */
export function parseInfo(d: Uint8Array): DeviceInfo {
  if (d.length < 38) throw new Error(`GET_INFO reply too short (${d.length} B)`)
  const snLen = Math.min(d[37], 18)
  const y = u16le(d, 24)
  return {
    model: '',
    hwVersion: String.fromCharCode(d[0]),
    fwVersion: dotted(d, 1),
    bootloaderVersion: dotted(d, 5),
    branchCode: latin1(d, 9, 8),
    fileVersion: d[17],
    protocolVersion: `${d[22]}.${d[23]}`,
    deviceTime: `${y}-${pad2(d[26])}-${pad2(d[27])} ${pad2(d[28])}:${pad2(d[29])}:${pad2(d[30])}`,
    sn: latin1(d, 38, snLen).trim(),
    extra: {
      projectId: `${d[18].toString(16).padStart(2, '0')}${d[19].toString(16).padStart(2, '0')}`,
      deviceType: `0x${u16le(d, 20).toString(16)}`,
      maxPacketLength: u16le(d, 31),
    },
  }
}

const BATTERY_STATES: BatteryState[] = ['normal', 'charging', 'full', 'low']

export function batteryState(v: number): BatteryState {
  return BATTERY_STATES[v] ?? 'normal'
}

/** GET_BATTERY 0xE4: state, percent, mV u16. */
export function parseBattery(d: Uint8Array): BatteryInfo {
  if (d.length < 4) throw new Error('GET_BATTERY reply too short')
  return { state: batteryState(d[0]), percent: d[1], mV: u16le(d, 2) }
}

/** GET_FILE_LIST 0xF1: count, then 16-byte name slots. */
export function parseFileList(d: Uint8Array): string[] {
  if (d.length < 1) return []
  const n = d[0]
  const names: string[] = []
  for (let i = 0; i < n && 1 + 16 * (i + 1) <= d.length; i++) {
    const name = latin1(d, 1 + 16 * i, 16).trim()
    if (name) names.push(name)
  }
  return names
}

export interface OxyIIConfig {
  spo2Vibrate: boolean
  spo2Sound: boolean
  hrVibrate: boolean
  hrSound: boolean
  spo2Low: number
  hrLow: number
  hrHigh: number
  motor: number
  buzzer: number
  displayMode: number
  brightness: number
  interval: number
  raw: Uint8Array
}

/** GET_CONFIG 0x00 (OxyIIConfig). Requires >= 9 bytes. */
export function parseConfig(d: Uint8Array): OxyIIConfig {
  if (d.length < 9) throw new Error('GET_CONFIG reply too short')
  return {
    spo2Vibrate: !!(d[0] & 0x01),
    spo2Sound: !!(d[0] & 0x02),
    hrVibrate: !!(d[0] & 0x10),
    hrSound: !!(d[0] & 0x20),
    spo2Low: d[1],
    hrLow: d[2],
    hrHigh: d[3],
    motor: d[4],
    buzzer: d[5],
    displayMode: d[6],
    brightness: d[7],
    interval: d[8],
    raw: d,
  }
}

/** SET_CONFIG config types (OxyIIBleCmd.ConfigType). */
export const ConfigType = {
  SPO2_SWITCH: 1,
  SPO2_LOW: 2,
  HR_SWITCH: 3,
  HR_LOW: 4,
  HR_HIGH: 5,
  MOTOR: 6,
  BUZZER: 7,
  DISPLAY_MODE: 8,
  BRIGHTNESS: 9,
  INTERVAL: 10,
} as const

/** Single-field SET_CONFIG payload: [type,0,0,0][value,0,0,0]. */
export function setConfigPayload(type: number, value: number): Uint8Array {
  return new Uint8Array([type, 0, 0, 0, value & 0xff, (value >> 8) & 0xff, 0, 0])
}

const SENSOR: SensorState[] = ['no-finger', 'ok', 'probe-off', 'fault']
const RUN_STATUS = ['idle', 'preparing', 'measuring', 'finished']

function waveFromBytes(d: Uint8Array): number[] {
  if (d.length < 6) return []
  const n = Math.min(u16le(d, 4), d.length - 6)
  const raw = Array.from(d.subarray(6, 6 + n))
  // 156 and 246 are pulse / marker bytes; interpolate over them like the app.
  const isMarker = (v: number) => v === 156 || v === 246
  const out = raw.slice()
  for (let i = 0; i < raw.length; i++) {
    if (!isMarker(raw[i])) continue
    const prev = i > 0 ? out[i - 1] : undefined
    const next = raw.slice(i + 1).find((v) => !isMarker(v))
    out[i] = prev !== undefined && next !== undefined ? (prev + next) >> 1 : (prev ?? next ?? 0)
  }
  return out
}

/** RT_DATA 0x04: RtParam (20 B) + RtWave. */
export function parseRtData(d: Uint8Array, t = Date.now()): LiveSample {
  if (d.length < 14) throw new Error('RT_DATA reply too short')
  const spo2 = d[6]
  const pr = u16le(d, 8)
  const piRaw = d[7]
  const spo2Valid = ![0, 127, 255].includes(spo2)
  const prValid = ![0, 255, 511, 65535].includes(pr)
  const valid = spo2Valid && prValid
  return {
    t,
    spo2: valid ? spo2 : null,
    pr: valid ? pr : null,
    pi: valid && piRaw !== 0 && piRaw !== 255 ? piRaw / 10 : null,
    // Motion (byte 11) is only meaningful while a finger is detected and the ring is
    // recording (runStatus 2); during the ~2 min warm-up it reads 0. Verified on an
    // O2Ring S: 0 when still, up to ~32 while shaking the hand.
    motion: d[4] === 2 && d[5] === 1 && d[11] !== 255 ? d[11] : null,
    batteryState: batteryState(d[12]),
    battery: d[13],
    sensor: SENSOR[d[5]] ?? 'unknown',
    status: RUN_STATUS[d[4]] ?? `status ${d[4]}`,
    wave: d.length >= 26 ? waveFromBytes(d.subarray(20)) : [],
  }
}

export function parseDuration(d: Uint8Array): number {
  return d.length >= 4 ? u32le(d, 0) : 0
}
