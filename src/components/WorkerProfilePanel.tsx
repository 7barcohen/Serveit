import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import {
  dayLongNames,
  formatDate,
  formatRating,
  LOW_RELIABILITY,
  reliabilityEventLabels,
  shiftLabels,
  shiftOptions,
} from '../lib/labels'
import { errorMessage } from '../lib/useNow'
import type { City, JobCategory, ReliabilityEvent, WorkerLicense, WorkerProfile } from '../types'

type Props = {
  profile: WorkerProfile
  cities: City[]
  categories: JobCategory[]
  onChanged: () => void
}

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])

// Worker profile & settings (spec §1.1, §5.1, §6.3).
export function WorkerProfilePanel({ profile, cities, categories, onChanged }: Props) {
  const [details, setDetails] = useState({
    fullName: profile.fullName,
    age: profile.age,
    city: profile.city,
    bio: profile.bio,
  })
  const [slots, setSlots] = useState<string[]>(profile.availabilitySlots)
  const [events, setEvents] = useState<ReliabilityEvent[]>([])
  const [licenses, setLicenses] = useState<WorkerLicense[]>([])
  const [newLicense, setNewLicense] = useState({ name: '', expiresAt: '', file: null as File | null })
  const [blockedIds, setBlockedIds] = useState<number[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const requiredLicenses = [...new Set(categories.map((category) => category.requiredLicense).filter(Boolean))] as string[]

  const loadExtras = useCallback(async () => {
    try {
      const [loadedEvents, loadedLicenses, blocked] = await Promise.all([
        api.getReliabilityEvents(profile.id),
        api.getLicenses(profile.id),
        api.getBlockedUserIds(),
      ])
      setEvents(loadedEvents)
      setLicenses(loadedLicenses)
      setBlockedIds(blocked)
    } catch {
      setError('טעינת נתוני הפרופיל נכשלה.')
    }
  }, [profile.id])

  useEffect(() => {
    void loadExtras()
  }, [loadExtras])

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'השמירה נכשלה.'))
    } finally {
      setBusy(false)
    }
  }

  const saveDetails = () => {
    if (details.fullName.trim().length < 2) {
      setError('יש להזין שם מלא.')
      return
    }
    if (!(details.age >= 16 && details.age <= 99)) {
      setError('גיל לא תקין.')
      return
    }
    void run(
      () => api.updateWorkerProfile(profile.id, { ...details, fullName: details.fullName.trim(), bio: details.bio.trim() }),
      'הפרטים נשמרו.',
    )
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('הדפדפן לא תומך באיתור מיקום.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        void run(
          () =>
            api.updateWorkerProfile(profile.id, {
              ...details,
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              locationLabel: 'מיקום נוכחי',
            }),
          'המיקום הנוכחי נשמר.',
        ),
      () => setError('לא ניתן לקבל מיקום. יש לאשר הרשאת מיקום בדפדפן.'),
    )
  }

  const addLicense = () => {
    if (newLicense.name.trim().length < 2) {
      setError('יש להזין שם רישיון או תעודה.')
      return
    }
    void run(async () => {
      await api.addLicense(profile.id, {
        name: newLicense.name.trim(),
        expiresAt: newLicense.expiresAt || null,
        file: newLicense.file,
      })
      setNewLicense({ name: '', expiresAt: '', file: null })
      await loadExtras()
    }, 'הרישיון נוסף וממתין לאימות.')
  }

  const lowScore = profile.reliabilityScore < LOW_RELIABILITY

  return (
    <section className="panel employer-grid">
      <article className={`card availability-card ${profile.isAvailable ? 'on' : 'off'}`}>
        <h2>סטטוס זמינות</h2>
        <label className="switch">
          <input
            type="checkbox"
            checked={profile.isAvailable}
            onChange={(event) =>
              void run(
                () => api.setAvailability(profile.id, event.target.checked),
                event.target.checked ? 'את/ה פעיל/ה בחיפוש עבודה.' : 'הפרופיל הושהה. הנתונים נשמרו.',
              )
            }
          />
          <span>{profile.isAvailable ? 'פעיל/ה בחיפוש עבודה' : 'לא פעיל/ה כרגע'}</span>
        </label>
        <p className="empty">
          כשהמתג כבוי, לא תופיעו למעסיקים ולא תקבלו משרות חדשות בפיד. שום דבר לא נמחק.
        </p>
      </article>

      <article className={`card reliability-card ${lowScore ? 'low' : ''}`}>
        <h2>מדד אמינות</h2>
        <p className="score">{profile.reliabilityScore}</p>
        <p>
          רצף משמרות ללא איחור: {profile.completedStreak}/5 · דירוג ממעסיקים: {formatRating(profile.rating || null, profile.ratingCount)}
        </p>
        {lowScore && (
          <p className="error-text">
            מדד מתחת ל-{LOW_RELIABILITY}: הפרופיל מוצג בתחתית הפיד של המעסיקים ואי אפשר להיכנס לרשימות המתנה.
          </p>
        )}
        <details>
          <summary>איך המדד מחושב?</summary>
          <ul className="landing-list">
            <li>מתחילים ב-100 נקודות</li>
            <li>משמרת שהושלמה: 2+, ו-10+ על כל 5 משמרות ברצף ללא איחור</li>
            <li>איחור של מעל 15 דקות: 5-</li>
            <li>ביטול 4–24 שעות לפני: 10-, פחות מ-4 שעות לפני: 20-</li>
            <li>אי-הגעה ללא הודעה: 35- והשעיה ל-7 ימים</li>
          </ul>
        </details>
        <div className="list admin-scroll">
          {events.length === 0 && <p className="empty">עוד אין אירועים.</p>}
          {events.map((event) => (
            <div key={event.id} className="list-item fit">
              <span>{reliabilityEventLabels[event.type]}</span>
              <strong className={event.delta < 0 ? 'negative' : 'positive'}>
                {event.delta > 0 ? `+${event.delta}` : event.delta}
              </strong>
            </div>
          ))}
        </div>
      </article>

      <article className="card">
        <h2>פרטים אישיים</h2>
        <label>
          שם מלא
          <input value={details.fullName} onChange={(event) => setDetails({ ...details, fullName: event.target.value })} />
        </label>
        <p className="empty">מעסיקים רואים רק את השם הפרטי שלך.</p>
        <label>
          גיל
          <input
            type="number"
            min={16}
            max={99}
            value={details.age}
            onChange={(event) => setDetails({ ...details, age: Number(event.target.value) })}
          />
        </label>
        <label>
          עיר מגורים
          <select value={details.city} onChange={(event) => setDetails({ ...details, city: event.target.value })}>
            {!cities.some((city) => city.name === details.city) && <option value={details.city}>{details.city}</option>}
            {cities.map((city) => (
              <option key={city.name}>{city.name}</option>
            ))}
          </select>
        </label>
        <p className="empty">מיקום לחישוב מרחק: {profile.locationLabel ?? 'לא הוגדר'}</p>
        <label>
          ניסיון ומה חשוב לדעת עליי
          <textarea
            rows={3}
            value={details.bio}
            maxLength={600}
            onChange={(event) => setDetails({ ...details, bio: event.target.value })}
            placeholder="לדוגמה: שנתיים מלצרות באירועים, אנגלית שוטפת"
          />
        </label>
        <p className="empty">טלפונים, מיילים וקישורים מוסתרים אוטומטית.</p>
        <div className="fit-actions">
          <button type="button" className="primary" onClick={saveDetails} disabled={busy}>
            שמירת פרטים
          </button>
          <button type="button" className="ghost" onClick={useCurrentLocation} disabled={busy}>
            שימוש במיקום הנוכחי
          </button>
        </div>
      </article>

      <article className="card">
        <h2>זמינות שבועית</h2>
        <p className="empty">סמנו מתי אתם בדרך כלל זמינים. בלי סימון = זמינות מלאה.</p>
        <div className="heatmap" role="grid" aria-label="זמינות שבועית">
          <span />
          {shiftOptions.map((shift) => (
            <span key={shift} className="heatmap-head">
              {shiftLabels[shift]}
            </span>
          ))}
          {dayLongNames.map((day, dayIndex) => (
            <div key={day} className="heatmap-row" role="row">
              <span className="heatmap-head">{day}</span>
              {shiftOptions.map((shift) => {
                const slot = `${dayIndex}:${shift}`
                const on = slots.includes(slot)
                return (
                  <button
                    key={slot}
                    type="button"
                    role="gridcell"
                    aria-pressed={on}
                    aria-label={`${day} ${shiftLabels[shift]}`}
                    className={`heatmap-cell ${on ? 'on' : ''}`}
                    onClick={() => setSlots(toggle(slots, slot))}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void run(() => api.setAvailabilitySlots(profile.id, slots), 'הזמינות השבועית נשמרה.')}
        >
          שמירת זמינות
        </button>
      </article>

      <article className="card">
        <h2>רישיונות ותעודות</h2>
        <div className="list">
          {licenses.length === 0 && <p className="empty">לא נוספו רישיונות.</p>}
          {licenses.map((license) => (
            <div key={license.id} className="list-item fit">
              <div>
                <strong>{license.name}</strong>
                <p>
                  {license.expiresAt ? `בתוקף עד ${formatDate(license.expiresAt)}` : 'ללא תאריך תפוגה'} ·{' '}
                  {license.isVerified ? 'מאומת' : 'ממתין לאימות'}
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => void run(async () => {
                  await api.deleteLicense(license)
                  await loadExtras()
                }, 'הרישיון הוסר.')}
              >
                הסרה
              </button>
            </div>
          ))}
        </div>
        <label>
          שם הרישיון / התעודה
          <input
            list="license-suggestions"
            value={newLicense.name}
            onChange={(event) => setNewLicense({ ...newLicense, name: event.target.value })}
          />
          <datalist id="license-suggestions">
            {requiredLicenses.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label>
          בתוקף עד
          <input
            type="date"
            value={newLicense.expiresAt}
            onChange={(event) => setNewLicense({ ...newLicense, expiresAt: event.target.value })}
          />
        </label>
        <label>
          צילום / PDF
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => setNewLicense({ ...newLicense, file: event.target.files?.[0] ?? null })}
          />
        </label>
        <button type="button" className="primary" onClick={addLicense} disabled={busy}>
          הוספה
        </button>
      </article>

      <article className="card">
        <h2>קידום פרופיל</h2>
        <p className="empty">
          {profile.sponsoredUntil && new Date(profile.sponsoredUntil) > new Date()
            ? `הפרופיל מקודם עד ${formatDate(profile.sponsoredUntil)}.`
            : 'הבלטה של הפרופיל בראש רשימת המועמדים אצל מעסיקים.'}
        </p>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => void run(() => api.requestSponsorship(null, 7), 'בקשת הקידום נשלחה לאישור.')}
        >
          בקשת קידום ל-7 ימים
        </button>
        {blockedIds.length > 0 && (
          <>
            <h3>משתמשים חסומים</h3>
            <div className="list">
              {blockedIds.map((id) => (
                <div key={id} className="list-item fit">
                  <span>משתמש #{id}</span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void run(async () => {
                      await api.unblockUser(id)
                      await loadExtras()
                    }, 'החסימה הוסרה.')}
                  >
                    ביטול חסימה
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </article>

      {(message || error) && (
        <article className="card full-row">
          {message && <p className="status-box">{message}</p>}
          {error && <p className="error-text">{error}</p>}
        </article>
      )}
    </section>
  )
}
