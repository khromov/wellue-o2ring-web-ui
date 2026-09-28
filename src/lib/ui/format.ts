import type { PatientInfo } from '../storage'

/** O2 Insight style duration: "7h38m12s", "12m5s", "40s". */
export function fmtDur(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h) return `${h}h${String(m).padStart(2, '0')}m${String(r).padStart(2, '0')}s`
  if (m) return `${m}m${String(r).padStart(2, '0')}s`
  return `${r}s`
}

export function fmtHeight(cm: number, units: 'metric' | 'imperial'): string {
  if (units === 'metric') return `${Math.round(cm)} cm`
  const inches = cm / 2.54
  return `${Math.floor(inches / 12)} ft ${Math.round(inches % 12)} in`
}

export function fmtWeight(kg: number, units: 'metric' | 'imperial'): string {
  return units === 'metric' ? `${Math.round(kg * 10) / 10} kg` : `${Math.round(kg * 2.20462)} lbs`
}

export function bmi(p: PatientInfo): string | null {
  if (!p.heightCm || !p.weightKg) return null
  const m = p.heightCm / 100
  return (p.weightKg / (m * m)).toFixed(1)
}
