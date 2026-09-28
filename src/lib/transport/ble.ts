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
    public profile: GattProfile,
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
    const gatt = device.gatt
    // connect() can't be aborted; if it completes after our timeout, drop the link
    // so the device doesn't stay connected (and invisible) in the background.
    let timedOut = false
    const server = await withTimeout(
      gatt.connect().then((s) => {
        if (timedOut) gatt.disconnect()
        return s
      }),
      20000,
      'GATT connect timed out',
    ).catch((e) => {
      timedOut = true
      gatt.disconnect()
      throw e
    })
    let lastErr: unknown
    for (const profile of opts.profiles) {
      try {
        const [writeChar, notifyChar] = await openProfile(server, profile)
        return new BleTransport(device, writeChar, notifyChar, profile, opts.chunkSize ?? 20)
      } catch (e) {
        lastErr = e
      }
    }
    gatt.disconnect()
    throw new Error(`No supported GATT service found on ${device.name ?? 'device'}: ${String(lastErr)}`)
  }

  /** Move to another service on the same connection (dual-protocol devices). */
  async switchProfile(profile: GattProfile): Promise<void> {
    const server = this.device.gatt
    if (!server?.connected) throw new Error('Not connected')
    const [writeChar, notifyChar] = await openProfile(server, profile)
    this.notifyChar.removeEventListener('characteristicvaluechanged', this.handleNotify)
    await this.notifyChar.stopNotifications().catch(() => {})
    this.writeChar = writeChar
    this.notifyChar = notifyChar
    this.profile = profile
    notifyChar.addEventListener('characteristicvaluechanged', this.handleNotify)
  }

  hasService(service: BluetoothServiceUUID): Promise<boolean> {
    const server = this.device.gatt
    if (!server?.connected) return Promise.resolve(false)
    return server.getPrimaryService(service).then(
      () => true,
      () => false,
    )
  }

  private handleNotify = (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value
    if (!v) return
    const chunk = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
    this.onLog?.('rx', chunk)
    this.onData(chunk)
  }

  private handleDisconnect = () => {
    // Detach from the (reused) BluetoothDevice so a later session isn't disturbed.
    this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect)
    this.notifyChar.removeEventListener('characteristicvaluechanged', this.handleNotify)
    if (!this.closing) this.onDisconnect()
    this.closing = true
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

async function openProfile(
  server: BluetoothRemoteGATTServer,
  profile: GattProfile,
): Promise<[BluetoothRemoteGATTCharacteristic, BluetoothRemoteGATTCharacteristic]> {
  const service = await server.getPrimaryService(profile.service)
  const writeChar = await service.getCharacteristic(profile.write)
  const notifyChar = await service.getCharacteristic(profile.notify)
  // Notifications must be on before the first write.
  await notifyChar.startNotifications()
  return [writeChar, notifyChar]
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
