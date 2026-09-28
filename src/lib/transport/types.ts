export type TransportKind = 'ble' | 'hid' | 'demo'

/** A byte pipe to a device. Framing above this layer is protocol specific. */
export interface Transport {
  readonly kind: TransportKind
  /** Human readable device name (BLE name / USB product string). */
  readonly name: string
  write(data: Uint8Array): Promise<void>
  /** Set by the protocol layer; receives raw chunks as they arrive. */
  onData: (chunk: Uint8Array) => void
  onDisconnect: () => void
  close(): Promise<void>
  /** Log hook for the debug console. */
  onLog?: (dir: 'tx' | 'rx', data: Uint8Array) => void
}
