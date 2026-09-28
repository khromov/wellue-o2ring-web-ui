import { isLegacyFile, parseLegacyFile } from './legacyFile'
import { isOxyIIFile, isUnfinalisedOxyIIFile, parseOxyIIFile } from './oxyiiFile'
import type { Recording } from './recording'

/** Detect the record format from content, the same way O2 Insight Pro does (trailer magic). */
export function sniffFormat(bytes: Uint8Array): 'oxyii' | 'legacy' {
  if (isOxyIIFile(bytes) || isUnfinalisedOxyIIFile(bytes)) return 'oxyii'
  if (isLegacyFile(bytes)) return 'legacy'
  throw new Error('Unrecognized file format')
}

export function parseAny(bytes: Uint8Array, format?: string, fileName?: string, intervalHint?: number): Recording {
  const f = format === 'oxyii' || format === 'legacy' ? format : sniffFormat(bytes)
  return f === 'oxyii' ? parseOxyIIFile(bytes, fileName, intervalHint) : parseLegacyFile(bytes)
}
