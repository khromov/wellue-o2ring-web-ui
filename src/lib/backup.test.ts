import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildBackup, readBackup, backupFileName } from './backup'
import { makeOxyIIFile } from './files/oxyiiFile.test'
import type { StoredFile } from './storage'

const ring: StoredFile = {
  id: '2632300541/20260916031729',
  fileName: '20260916031729',
  format: 'oxyii',
  deviceModel: 'O2Ring S',
  deviceSn: '2632300541',
  startTime: 1,
  addedAt: 2,
  bytes: makeOxyIIFile(Array.from({ length: 50 }, () => [97, 60, 0] as [number, number, number])),
  note: 'good night',
  patient: { name: 'Test' },
}
const junk: StoredFile = { id: 'import/notes.txt', fileName: 'notes.txt', format: 'unknown', addedAt: 3, bytes: new Uint8Array([1, 2, 3]) }

describe('all-data backup', () => {
  it('round-trips recordings, annotations and settings', async () => {
    const zip = await buildBackup([ring, junk], { units: 'imperial', spo2Range: '70-100' }, ['x/y'], { now: new Date(2026, 8, 29) })
    const { manifest, bytes } = await readBackup(zip)
    expect(manifest.recordings).toHaveLength(2)
    expect(bytes.get(ring.id)).toEqual(ring.bytes)
    expect(bytes.get(junk.id)).toEqual(junk.bytes)
    const r = manifest.recordings.find((x) => x.id === ring.id)!
    expect(r.note).toBe('good night')
    expect(r.patient).toEqual({ name: 'Test' })
    expect(r.file).toBe('recordings/2632300541/20260916031729')
    expect(r.csv).toMatch(/^csv\/O2RingS_\d{14}\.csv$/)
    expect(manifest.recordings.find((x) => x.id === junk.id)!.csv).toBeNull()
    expect(manifest.settings).toEqual({ units: 'imperial', spo2Range: '70-100' })
    expect(manifest.removedIds).toEqual(['x/y'])
  })

  it('contains a readable README and an O2 Insight CSV', async () => {
    const files = unzipSync(await buildBackup([ring], {}, []))
    expect(Object.keys(files)).toContain('README.txt')
    const csv = Object.entries(files).find(([k]) => k.startsWith('csv/'))![1]
    expect(strFromU8(csv).split('\n')[0]).toBe('Time,Oxygen Level(%),Pulse Rate(bpm),Motion,Oxygen Level Reminder,PR Reminder,')
  })

  it('keeps same-named files apart', async () => {
    const other = { ...ring, id: 'import/20260916031729', deviceSn: undefined }
    const twin = { ...ring, id: 'import/20260916031729 (2)', deviceSn: undefined }
    const { manifest } = await readBackup(await buildBackup([other, twin], {}, []))
    expect(new Set(manifest.recordings.map((r) => r.file)).size).toBe(2)
  })

  it('rejects files that are not backups', async () => {
    await expect(readBackup(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a ZIP/)
  })

  it('names the file by date', () => {
    expect(backupFileName(new Date(2026, 8, 29))).toBe('o2ring-backup-2026-09-29.zip')
  })
})
