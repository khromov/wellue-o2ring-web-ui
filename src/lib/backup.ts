// All-data backup: a ZIP with every recording's raw device file (byte for
// byte, usable in other tools such as OSCAR), an O2 Insight-format CSV per
// recording, and a manifest with annotations and settings for restoring.

import { strFromU8, strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate'
import type { StoredFile } from './storage'
import { parseAny } from './files/parse'
import { exportBaseName, recordingToCsv } from './files/csv'

export const BACKUP_KIND = 'o2ring-web-backup'
export const BACKUP_VERSION = 1

export interface BackupRecording extends Omit<StoredFile, 'bytes'> {
  /** Path of the raw device file inside the ZIP. */
  file: string
  /** Path of the CSV export inside the ZIP, if the file could be parsed. */
  csv: string | null
}

export interface BackupManifest {
  kind: typeof BACKUP_KIND
  version: number
  exportedAt: string
  settings: Record<string, unknown>
  removedIds: string[]
  recordings: BackupRecording[]
}

export interface Backup {
  manifest: BackupManifest
  /** Raw bytes per recording id. */
  bytes: Map<string, Uint8Array>
}

const README = `O2Ring Web backup
=================

recordings/<serial>/<name>   Raw record files exactly as downloaded from the device
                             (O2Ring S / OxyII or legacy Viatom format). Other tools,
                             e.g. OSCAR, can import these.
csv/<device>_<time>.csv      One CSV per recording in O2 Insight Pro's export format.
manifest.json                Remarks, patient info and app settings, used by
                             Options > Restore from backup.
`

function safe(name: string): string {
  return name.replace(/[^\w.() -]+/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'file'
}

function uniquePath(path: string, used: Set<string>): string {
  let p = path
  for (let n = 2; used.has(p); n++) {
    const dot = path.lastIndexOf('.')
    p = dot > path.lastIndexOf('/') ? `${path.slice(0, dot)} (${n})${path.slice(dot)}` : `${path} (${n})`
  }
  used.add(p)
  return p
}

function zipAsync(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data))))
}

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => unzip(data, (err, files) => (err ? reject(err) : resolve(files))))
}

export async function buildBackup(
  files: StoredFile[],
  settings: Record<string, unknown>,
  removedIds: string[],
  opts: { csv?: boolean; now?: Date } = {},
): Promise<Uint8Array> {
  const used = new Set<string>(['manifest.json', 'README.txt'])
  const entries: Zippable = { 'README.txt': strToU8(README) }
  const recordings: BackupRecording[] = []
  for (const f of files) {
    const { bytes, ...meta } = f
    const file = uniquePath(`recordings/${safe(f.deviceSn || 'imported')}/${safe(f.fileName)}`, used)
    // Raw files are usually already dense; store them without recompressing.
    entries[file] = [bytes, { level: 0 }]
    let csv: string | null = null
    if (opts.csv !== false) {
      try {
        const rec = parseAny(bytes, f.format, f.fileName, f.intervalHint)
        csv = uniquePath(`csv/${safe(exportBaseName(rec, f.deviceModel ?? 'O2'))}.csv`, used)
        entries[csv] = strToU8(recordingToCsv(rec))
      } catch {
        csv = null // unparseable files are still backed up raw
      }
    }
    recordings.push({ ...meta, file, csv })
  }
  const manifest: BackupManifest = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    settings,
    removedIds,
    recordings,
  }
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  return zipAsync(entries)
}

export async function readBackup(data: Uint8Array): Promise<Backup> {
  let files: Unzipped
  try {
    files = await unzipAsync(data)
  } catch {
    throw new Error('This file is not a ZIP backup')
  }
  const raw = files['manifest.json']
  if (!raw) throw new Error('No manifest.json: this is not an O2Ring Web backup')
  const manifest = JSON.parse(strFromU8(raw)) as BackupManifest
  if (manifest.kind !== BACKUP_KIND) throw new Error('Not an O2Ring Web backup')
  if (manifest.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app')
  const bytes = new Map<string, Uint8Array>()
  for (const r of manifest.recordings ?? []) {
    const b = files[r.file]
    if (b) bytes.set(r.id, b)
  }
  return { manifest, bytes }
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `o2ring-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.zip`
}
