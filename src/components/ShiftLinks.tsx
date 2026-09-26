import { downloadIcs, googleCalendarUrl, googleMapsUrl, wazeUrl } from '../lib/shiftLinks'
import type { Application } from '../types'

// Calendar sync + navigation for a confirmed shift (spec §3.3).
export function ShiftLinks({ application }: { application: Application }) {
  const offer = application.offer
  if (!offer || offer.status !== 'accepted') {
    return null
  }
  const event = {
    title: `${application.job.title} – ${application.employer.name}`,
    startsAt: offer.startsAt,
    endsAt: offer.endsAt,
    address: offer.address,
    details: `משמרת דרך WorkAway. ${offer.conditions}`.trim(),
  }
  return (
    <div className="fit-actions">
      <a className="ghost link-button" href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">
        הוספה ל-Google Calendar
      </a>
      <button type="button" className="ghost" onClick={() => downloadIcs(event, `workaway-shift-${application.id}.ics`)}>
        הוספה ליומן (Apple / Outlook)
      </button>
      <a className="ghost link-button" href={wazeUrl(offer.address)} target="_blank" rel="noreferrer">
        ניווט ב-Waze
      </a>
      <a className="ghost link-button" href={googleMapsUrl(offer.address)} target="_blank" rel="noreferrer">
        ניווט ב-Google Maps
      </a>
    </div>
  )
}
