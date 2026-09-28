import type { Transport } from '../transport/types'
import { LegacySession } from './legacySession'
import type { DeviceModel } from './models'
import { OxyIISession } from './oxyiiSession'
import type { DeviceSession, ProtocolFamily } from './types'

/**
 * Pick the session by the wire protocol actually in use. Dual-protocol legacy
 * models can also run OxyII framing on the e8fb service; their files are
 * still legacy-format and are sniffed by content.
 */
export function createSession(transport: Transport, model: DeviceModel, wire: ProtocolFamily): DeviceSession {
  return wire === 'oxyii' ? new OxyIISession(transport, model) : new LegacySession(transport, model)
}
