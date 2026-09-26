// Calendar and navigation links for a confirmed shift (spec §3.3). These use
// public URL schemes and a standard .ics file, so no API keys are needed.

type ShiftEvent = {
  title: string
  startsAt: string
  endsAt: string
  address: string
  details: string
}

const toIcsDate = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

const escapeIcs = (value: string) => value.replace(/\\/g, '\\\\').replace(/[,;]/g, (match) => `\\${match}`).replace(/\n/g, '\\n')

export const googleCalendarUrl = (event: ShiftEvent) => {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toIcsDate(event.startsAt)}/${toIcsDate(event.endsAt)}`,
    location: event.address,
    details: event.details,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// Opens in Apple Calendar / Outlook / Android calendar apps, with 24h and 2h alarms.
export const downloadIcs = (event: ShiftEvent, fileName: string) => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WorkAway//Shift//HE',
    'BEGIN:VEVENT',
    `UID:${toIcsDate(event.startsAt)}-${Math.random().toString(36).slice(2)}@workaway`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(event.startsAt)}`,
    `DTEND:${toIcsDate(event.endsAt)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `LOCATION:${escapeIcs(event.address)}`,
    `DESCRIPTION:${escapeIcs(event.details)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT24H', 'ACTION:DISPLAY', 'DESCRIPTION:משמרת מחר', 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:משמרת בעוד שעתיים', 'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export const wazeUrl = (address: string) => `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`

export const googleMapsUrl = (address: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
