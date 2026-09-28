import type { Transport } from '../transport/types'

export type ProtocolFamily = 'oxyii' | 'legacy'

export interface DeviceInfo {
  /** Display model name, e.g. "O2Ring S". */
  model: string
  modelId?: number
  sn?: string
  hwVersion?: string
  fwVersion?: string
  bootloaderVersion?: string
  branchCode?: string
  fileVersion?: number
  protocolVersion?: string
  /** Device clock as reported (device-local wall clock). */
  deviceTime?: string
  /** Additional raw fields for the debug/info table. */
  extra: Record<string, string | number>
}

export type BatteryState = 'normal' | 'charging' | 'full' | 'low'

export interface BatteryInfo {
  percent: number
  state: BatteryState
  mV?: number
}

export type SensorState = 'ok' | 'no-finger' | 'probe-off' | 'fault' | 'unknown'

export interface LiveSample {
  /** Host timestamp, ms. */
  t: number
  spo2: number | null
  pr: number | null
  pi: number | null
  motion: number | null
  battery?: number
  batteryState?: BatteryState
  sensor: SensorState
  /** Pleth / PPG waveform samples received with this update (arbitrary units). */
  wave: number[]
  /** Device status text, e.g. "measuring". */
  status?: string
}

export interface SettingOption {
  value: number
  label: string
}

export interface SettingDef {
  key: string
  label: string
  kind: 'select' | 'toggle'
  options?: SettingOption[]
  value: number
  help?: string
}

export interface ReadProgress {
  done: number
  total: number
}

export interface DeviceSession {
  readonly family: ProtocolFamily
  readonly transport: Transport
  info: DeviceInfo | null
  /** Run the connect handshake. */
  init(opts: { syncTime: boolean }): Promise<void>
  refreshInfo(): Promise<DeviceInfo>
  getBattery(): Promise<BatteryInfo | null>
  listFiles(): Promise<string[]>
  readFile(name: string, onProgress?: (p: ReadProgress) => void, signal?: AbortSignal): Promise<Uint8Array>
  getSettings(): Promise<SettingDef[]>
  writeSetting(key: string, value: number): Promise<void>
  syncTime(): Promise<void>
  startLive(onSample: (s: LiveSample) => void): void
  stopLive(): Promise<void>
  close(): Promise<void>
  /** True while a file transfer or setting write holds the device. */
  readonly busy: boolean
  onDisconnect: () => void
  onStatus?: (msg: string) => void
  /** Non-fatal problems (e.g. an optional handshake step failed). */
  onWarn?: (msg: string) => void
}

export class DeviceError extends Error {}
