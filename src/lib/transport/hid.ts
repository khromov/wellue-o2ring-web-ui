// WebHID transport for the O2Ring S over USB.
//
// The ring enumerates as a vendor-defined HID device (Nordic VID 0x1915,
// PID 0xF33C) with 64-byte input/output reports and no report IDs. Each
// report, in both directions, is:
//
//   byte 0      N = number of valid bytes that follow (1..63)
//   bytes 1..N  next N bytes of the OxyII frame stream
//   rest        zero padding
//
// Without the N prefix the ring silently ignores everything.

import type { Transport } from './types'

export const HID_FILTERS: HIDDeviceFilter[] = [{ vendorId: 0x1915, productId: 0xf33c }]
const REPORT_SIZE = 64

export function hidSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator
}

export class HidTransport implements Transport {
  readonly kind = 'hid' as const
  onData: (chunk: Uint8Array) => void = () => {}
  onDisconnect: () => void = () => {}
  onLog?: (dir: 'tx' | 'rx', data: Uint8Array) => void

  private constructor(private device: HIDDevice) {
    device.addEventListener('inputreport', this.handleReport)
    navigator.hid.addEventListener('disconnect', this.handleDisconnect)
  }

  get name(): string {
    return this.device.productName || 'USB device'
  }

  static async request(): Promise<HidTransport> {
    const [device] = await navigator.hid.requestDevice({ filters: HID_FILTERS })
    if (!device) throw new Error('No device selected')
    return HidTransport.open(device)
  }

  /** Reconnect to a previously granted device without a picker. */
  static async reopenGranted(): Promise<HidTransport | null> {
    const devices = await navigator.hid.getDevices()
    const device = devices.find((d) => HID_FILTERS.some((f) => f.vendorId === d.vendorId && f.productId === d.productId))
    return device ? HidTransport.open(device) : null
  }

  private static async open(device: HIDDevice): Promise<HidTransport> {
    if (!device.opened) await device.open()
    return new HidTransport(device)
  }

  private handleReport = (e: HIDInputReportEvent) => {
    const report = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)
    const n = Math.min(report[0], report.length - 1)
    if (n <= 0) return
    const chunk = report.slice(1, 1 + n)
    this.onLog?.('rx', chunk)
    this.onData(chunk)
  }

  private handleDisconnect = (e: HIDConnectionEvent) => {
    if (e.device === this.device) this.onDisconnect()
  }

  async write(data: Uint8Array): Promise<void> {
    this.onLog?.('tx', data)
    for (let o = 0; o < data.length; o += REPORT_SIZE - 1) {
      const part = data.subarray(o, o + REPORT_SIZE - 1)
      const report = new Uint8Array(REPORT_SIZE)
      report[0] = part.length
      report.set(part, 1)
      await this.device.sendReport(0, report)
    }
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.handleReport)
    navigator.hid.removeEventListener('disconnect', this.handleDisconnect)
    if (this.device.opened) await this.device.close()
  }
}
