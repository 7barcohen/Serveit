import type { City, Job, WorkerPreference, WorkerProfile } from '../types'

// Flexible feed matching (spec §2.1): jobs slightly outside a preference are
// still shown as "near" with the reason, instead of being filtered out, so the
// two sides can negotiate in chat.
export type JobFit = {
  level: 'exact' | 'near' | 'open'
  distanceKm: number | null
  notes: string[]
}

// Allowed slack before a job stops being shown.
const RADIUS_SLACK_FACTOR = 1.5
const RADIUS_SLACK_KM = 5
const PAY_SLACK = 0.9

export const distanceKm = (lat1: number | null, lng1: number | null, lat2: number | null, lng2: number | null) => {
  if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) {
    return null
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

const weekdaySlot = (job: Job) => `${new Date(`${job.date}T12:00:00`).getDay()}:${job.shift}`

const fitForPreference = (
  job: Job,
  preference: WorkerPreference,
  profile: WorkerProfile | undefined,
  citiesByName: Map<string, City>,
): JobFit | null => {
  if (job.employmentType !== preference.employmentType) {
    return null
  }
  const notes: string[] = []

  const origin = preference.city ? citiesByName.get(preference.city) : undefined
  const distance = distanceKm(origin?.lat ?? profile?.lat ?? null, origin?.lng ?? profile?.lng ?? null, job.lat, job.lng)
  if (distance !== null && distance > preference.radiusKm) {
    if (distance > preference.radiusKm * RADIUS_SLACK_FACTOR + RADIUS_SLACK_KM) {
      return null
    }
    notes.push(`מעט מחוץ לטווח (${Math.round(distance)} ק״מ)`)
  }

  const pay = job.payType === 'hourly' ? job.hourlyPay : job.monthlyPay
  const minimum = job.payType === 'hourly' ? preference.minHourlyPay : preference.minMonthlyPay
  if (pay !== null && minimum > 0 && pay < minimum) {
    if (pay < minimum * PAY_SLACK) {
      return null
    }
    notes.push('שכר מעט נמוך מהמבוקש')
  }

  if (preference.categories.length > 0 && !preference.categories.includes(job.category)) {
    notes.push('תחום שונה מהמבוקש')
  }

  if (job.employmentType === 'permanent' && job.workload && preference.workloads.length > 0
      && !preference.workloads.includes(job.workload)) {
    notes.push(job.workload === 'full' ? 'משרה מלאה' : 'משרה חלקית')
  }

  if (job.employmentType === 'temporary') {
    const weeklyAvailable = !profile || profile.availabilitySlots.length === 0
      || profile.availabilitySlots.includes(weekdaySlot(job))
    const onChosenDate = preference.availableDates.includes(job.date)
    if (preference.availableDates.length > 0 && !onChosenDate) {
      if (!weeklyAvailable || profile?.availabilitySlots.length === 0) {
        return null
      }
      notes.push('לא בתאריך שסימנת, אבל בזמינות השבועית')
    } else if (preference.availableDates.length === 0 && !weeklyAvailable) {
      notes.push('מחוץ לזמינות השבועית')
    }
  }

  if (preference.transportOnly && !job.transportOffered) {
    notes.push('ללא הסעה')
  }

  return { level: notes.length === 0 ? 'exact' : 'near', distanceKm: distance, notes }
}

// Best fit across all saved preferences, or null if the job should be hidden.
export const evaluateJob = (
  job: Job,
  profile: WorkerProfile | undefined,
  citiesByName: Map<string, City>,
): JobFit | null => {
  const preferences = profile?.preferences ?? []
  if (preferences.length === 0) {
    return {
      level: 'open',
      distanceKm: distanceKm(profile?.lat ?? null, profile?.lng ?? null, job.lat, job.lng),
      notes: [],
    }
  }
  let best: JobFit | null = null
  for (const preference of preferences) {
    const fit = fitForPreference(job, preference, profile, citiesByName)
    if (fit && (!best || fit.notes.length < best.notes.length)) {
      best = fit
    }
  }
  return best
}

const levelRank: Record<JobFit['level'], number> = { exact: 0, open: 0, near: 1 }

// Exact matches first; sponsored jobs lead within a tier; employers with a low
// rating (after their warning period) lose exposure; then distance and date.
export const rankJobs = (entries: Array<{ job: Job; fit: JobFit }>) =>
  [...entries].sort((a, b) =>
    levelRank[a.fit.level] - levelRank[b.fit.level]
    || Number(b.job.isSponsored) - Number(a.job.isSponsored)
    || Number(a.job.employerLowRating) - Number(b.job.employerLowRating)
    || a.fit.notes.length - b.fit.notes.length
    || (a.fit.distanceKm ?? Infinity) - (b.fit.distanceKm ?? Infinity)
    || a.job.date.localeCompare(b.job.date),
  )
