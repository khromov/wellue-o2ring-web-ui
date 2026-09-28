import type { Recording } from './recording'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Qt "hh:mm:ssAP MMM d, yyyy", e.g. "03:17:29AM Sep 16, 2026". */
export function o2InsightTime(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${pad(h12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${h < 12 ? 'AM' : 'PM'} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/**
 * CSV in O2 Insight Pro's export format (ReportHelper): one row per sample,
 * raw values (255 = invalid SpO2, 65535 = invalid pulse), reminder flags,
 * and a trailing comma on every line.
 */
export function recordingToCsv(r: Recording): string {
  const rows = ['Time,Oxygen Level(%),Pulse Rate(bpm),Motion,Oxygen Level Reminder,PR Reminder,']
  const raw = r.raw
  for (let i = 0; i < r.spo2.length; i++) {
    const t = r.start + i * r.interval * 1000
    const spo2 = raw ? raw.spo2[i] : (r.spo2[i] ?? 255)
    const pr = raw ? raw.pr[i] : (r.pr[i] ?? 65535)
    const motion = raw ? raw.motion[i] : (r.motion[i] ?? 0)
    rows.push(`"${o2InsightTime(t)}",${spo2},${pr},${motion},${r.spo2Alarm?.[i] ? 1 : 0},${r.prAlarm?.[i] ? 1 : 0},`)
  }
  return rows.join('\n') + '\n'
}

/** O2 Insight names exports `<DeviceName>_<yyyyMMddhhmmss>`. */
export function exportBaseName(r: Recording, deviceName = 'O2Ring'): string {
  const d = new Date(r.start)
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${deviceName.replace(/[^\w.-]+/g, '')}_${stamp}`
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
