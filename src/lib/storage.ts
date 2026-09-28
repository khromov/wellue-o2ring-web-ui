// Local persistence of downloaded / imported record files (IndexedDB).
// We store the raw bytes and re-parse on load so parser fixes apply to old data.

import { openDB, type IDBPDatabase } from 'idb'

export interface PatientInfo {
  name?: string
  id?: string
  gender?: '' | 'male' | 'female' | 'other'
  birthday?: string
  /** Always stored metric. */
  heightCm?: number
  weightKg?: number
  physician?: string
  note?: string
}

export interface StoredFile {
  /** `${deviceSn || 'import'}/${fileName}` */
  id: string
  fileName: string
  /** Parser family hint, e.g. 'oxyii' | 'legacy'. Parsers also sniff the bytes. */
  format: string
  deviceModel?: string
  deviceSn?: string
  /** Epoch ms of recording start if known (for sorting without parsing). */
  startTime?: number
  addedAt: number
  bytes: Uint8Array
  /** Free-text remark (O2 Insight "Mark"). */
  note?: string
  patient?: PatientInfo
}

const DB_NAME = 'o2ring-web-ui'
const STORE = 'files'

let dbp: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  dbp ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      const s = d.createObjectStore(STORE, { keyPath: 'id' })
      s.createIndex('startTime', 'startTime')
    },
  })
  return dbp
}

export async function saveFile(f: StoredFile): Promise<void> {
  await (await db()).put(STORE, f)
}

export async function getFile(id: string): Promise<StoredFile | undefined> {
  return (await db()).get(STORE, id)
}

export async function hasFile(id: string): Promise<boolean> {
  return (await (await db()).getKey(STORE, id)) !== undefined
}

export async function listFiles(): Promise<StoredFile[]> {
  const all: StoredFile[] = await (await db()).getAll(STORE)
  return all.sort((a, b) => (b.startTime ?? b.addedAt) - (a.startTime ?? a.addedAt))
}

export async function deleteFile(id: string): Promise<void> {
  await (await db()).delete(STORE, id)
}

export async function updateFile(id: string, patch: Partial<StoredFile>): Promise<void> {
  const d = await db()
  const cur = await d.get(STORE, id)
  if (cur) await d.put(STORE, { ...cur, ...patch })
}

// Recordings the user removed locally: not offered again as "new" (like O2 Insight's tb_deleted).
const REMOVED_KEY = 'removedIds'

export function removedIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(REMOVED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function markRemoved(ids: string[], removed = true): void {
  const set = removedIds()
  for (const id of ids) removed ? set.add(id) : set.delete(id)
  try {
    localStorage.setItem(REMOVED_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}
