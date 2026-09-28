// Web Bluetooth transport. Viatom devices expose a vendor GATT service with
// one write characteristic and one notify characteristic; the byte stream on
// those is the protocol framing (0xAA legacy or 0xA5 OxyII).

import type { Transport } from './types'

export interface GattProfile {
  id: string
  service: BluetoothServiceUUID
  write: BluetoothCharacteristicUUID
  notify: BluetoothCharacteristicUUID
  /** Pause between write chunks (legacy firmware drops back-to-back writes). */
  chunkDelayMs?: number
}

export interface BleConnectOptions {
  /** Profiles to try in order; the first one whose service exists is used. */
  profiles: GattProfile[]
  /** Max bytes per GATT write. 20 is always safe (default ATT MTU). */
  chunkSize?: number
}

export function bleSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export class BleTransport implements Transport {
  readonly kind = 'ble' as const
  onData: (chunk: Uint8Array) => void = () => {}
  onDisconnect: () => void = () => {}
  onLog?: (dir: 'tx' | 'rx', data: Uint8Array) => void
  private closing = false
  private writeQueue: Promise<void> = Promise.resolve()

  private constructor(
    private device: BluetoothDevice,
    private writeChar: BluetoothRemoteGATTCharacteristic,
    private notifyChar: BluetoothRemoteGATTCharacteristic,
    readonly profile: GattProfile,
    private chunkSize: number,
  ) {
    notifyChar.addEventListener('characteristicvaluechanged', this.handleNotify)
    device.addEventListener('gattserverdisconnected', this.handleDisconnect)
  }

  get name(): string {
    return this.device.name || 'Bluetooth device'
  }

  get deviceId(): string {
    return this.device.id
  }

  /** Show the browser's device chooser. */
  static pick(filters: BluetoothLEScanFilter[], optionalServices: BluetoothServiceUUID[]): Promise<BluetoothDevice> {
    return navigator.bluetooth.requestDevice({ filters, optionalServices })
  }

  static async connect(device: BluetoothDevice, opts: BleConnectOptions): Promise<BleTransport> {
    if (!device.gatt) throw new Error('Device has no GATT server')
    const server = await withTimeout(device.gatt.connect(), 20000, 'GATT connect timed out')
    let lastErr: unknown
    for (const profile of opts.profiles) {
      try {
        const service = await server.getPrimaryService(profile.service)
        const writeChar = await service.getCharacteristic(profile.write)
        const notifyChar = await service.getCharacteristic(profile.notify)
        await notifyChar.startNotifications()
        return new BleTransport(device, writeChar, notifyChar, profile, opts.chunkSize ?? 20)
      } catch (e) {
        lastErr = e
      }
    }
    device.gatt.disconnect()
    throw new Error(`No supported GATT service found on ${device.name ?? 'device'}: ${String(lastErr)}`)
  }

  private handleNotify = (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value
    if (!v) return
    const chunk = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
    this.onLog?.('rx', chunk)
    this.onData(chunk)
  }

  private handleDisconnect = () => {
    if (!this.closing) this.onDisconnect()
  }

  write(data: Uint8Array): Promise<void> {
    // Serialize writes: GATT allows only one operation in flight.
    const run = async () => {
      this.onLog?.('tx', data)
      const noRsp = this.writeChar.properties.writeWithoutResponse
      for (let o = 0; o < data.length; o += this.chunkSize) {
        const part = data.slice(o, o + this.chunkSize)
        if (o > 0 && this.profile.chunkDelayMs) await new Promise((r) => setTimeout(r, this.profile.chunkDelayMs))
        if (noRsp) await this.writeChar.writeValueWithoutResponse(part)
        else await this.writeChar.writeValueWithResponse(part)
      }
    }
    const p = this.writeQueue.then(run, run)
    this.writeQueue = p.catch(() => {})
    return p
  }

  async close(): Promise<void> {
    this.closing = true
    try {
      this.notifyChar.removeEventListener('characteristicvaluechanged', this.handleNotify)
      await this.notifyChar.stopNotifications().catch(() => {})
    } finally {
      this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect)
      this.device.gatt?.disconnect()
    }
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}
