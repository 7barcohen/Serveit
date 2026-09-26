import type {
  ApplicationStage,
  EmploymentType,
  OfferPayType,
  PayType,
  Region,
  ReliabilityEvent,
  ShiftWindow,
  SubscriptionStatus,
  Workload,
} from '../types'

export const shiftLabels: Record<ShiftWindow, string> = {
  morning: 'בוקר',
  afternoon: 'צהריים',
  evening: 'ערב',
  night: 'לילה',
}

export const employmentTypeLabels: Record<EmploymentType, string> = {
  temporary: 'משרה זמנית',
  permanent: 'משרה קבועה',
}

export const regionLabels: Record<Region, string> = {
  north: 'צפון',
  haifa: 'חיפה והקריות',
  sharon: 'שרון',
  center: 'מרכז',
  tel_aviv: 'תל אביב וגוש דן',
  jerusalem: 'ירושלים והסביבה',
  shfela: 'שפלה',
  south: 'דרום',
}

export const workloadLabels: Record<Workload, string> = {
  full: 'משרה מלאה',
  part: 'משרה חלקית',
}

export const stageLabels: Record<ApplicationStage, string> = {
  liked: 'ממתין לתגובת המעסיק',
  shortlisted: 'ברשימה הקצרה',
  matched: 'Match',
  offered: 'הצעה ממתינה',
  hired: 'משובץ/ת',
  waitlisted: 'ברשימת המתנה',
  completed: 'הושלם',
  no_show: 'אי-הגעה',
  canceled: 'בוטל',
  declined: 'לא רלוונטי',
}

export const subscriptionLabels: Record<SubscriptionStatus, string> = {
  trial: 'תקופת ניסיון',
  active: 'מנוי פעיל',
  pending_payment: 'ממתין לתשלום',
  expired: 'הסתיים',
}

export const reliabilityEventLabels: Record<ReliabilityEvent['type'], string> = {
  no_show: 'אי-הגעה ללא הודעה',
  cancel_under_4h: 'ביטול פחות מ-4 שעות לפני המשמרת',
  cancel_4_to_24h: 'ביטול 4–24 שעות לפני המשמרת',
  cancel_over_24h: 'ביטול יותר מ-24 שעות לפני המשמרת',
  late_arrival: 'איחור של מעל 15 דקות',
  shift_completed: 'משמרת הושלמה',
  streak_bonus: 'בונוס: 5 משמרות ברצף ללא איחור',
}

export const dayNames = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']
export const dayLongNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

export const shiftOptions = Object.keys(shiftLabels) as ShiftWindow[]
export const regionOptions = Object.keys(regionLabels) as Region[]

// Reliability score under this value: bottom of employer feeds, no waitlists.
export const LOW_RELIABILITY = 70

export const formatPay = (payType: PayType | OfferPayType, amount: number | null) => {
  if (amount === null) {
    return '—'
  }
  const value = `₪${amount.toLocaleString('he-IL')}`
  if (payType === 'hourly') return `${value} לשעה`
  if (payType === 'monthly') return `${value} לחודש`
  return `${value} גלובלי`
}

export const formatJobPay = (job: { payType: PayType; hourlyPay: number | null; monthlyPay: number | null }) =>
  formatPay(job.payType, job.payType === 'hourly' ? job.hourlyPay : job.monthlyPay)

const dateTimeFormat = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jerusalem',
})

const dateFormat = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Jerusalem',
})

export const formatDateTime = (value: string | null) => (value ? dateTimeFormat.format(new Date(value)) : '—')

export const formatDate = (value: string | null) => (value ? dateFormat.format(new Date(value)) : '—')

export const formatRating = (avg: number | null, count: number) =>
  avg === null || count === 0 ? 'חדש/ה – עדיין ללא דירוג' : `★ ${avg.toFixed(1)} (${count})`

// "in 14 min" style countdown for offer deadlines.
export const formatTimeLeft = (deadline: string, now: number) => {
  const ms = new Date(deadline).getTime() - now
  if (ms <= 0) return 'פג תוקף'
  const minutes = Math.ceil(ms / 60000)
  if (minutes < 60) return `נותרו ${minutes} דק׳`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `נותרו ${hours} שע׳ ו-${minutes % 60} דק׳`
  return `נותרו ${Math.floor(hours / 24)} ימים`
}
