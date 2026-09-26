import { useMemo, useState } from 'react'
import { api } from '../api'
import { dayNames, employmentTypeLabels, workloadLabels } from '../lib/labels'
import { errorMessage } from '../lib/useNow'
import type { City, JobCategory, Workload, WorkerPreference, WorkerPreferenceInput, WorkerProfile } from '../types'

type Props = {
  profile: WorkerProfile
  cities: City[]
  categories: JobCategory[]
  onChanged: () => void
}

const monthNames = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
]

const dateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 2026-09-15 -> 15/09
const shortDate = (value: string) => value.split('-').reverse().slice(0, 2).join('/')

const toggleValue = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

export function PreferenceSummary({ preference }: { preference: WorkerPreference }) {
  return (
    <div>
      <strong>{employmentTypeLabels[preference.employmentType]}</strong>
      <p>
        אזור: {preference.city ?? 'מהמיקום שלי'} ועד {preference.radiusKm} ק״מ
      </p>
      <p>
        שכר מינימלי: {preference.minHourlyPay} ש"ח לשעה
        {preference.employmentType === 'permanent' && preference.minMonthlyPay > 0 && ` או ${preference.minMonthlyPay.toLocaleString('he-IL')} ש"ח לחודש`}
      </p>
      <p>תחומים: {preference.categories.length > 0 ? preference.categories.join(', ') : 'פתוח/ה לכל התחומים'}</p>
      {preference.employmentType === 'permanent' && (
        <p>
          היקף:{' '}
          {preference.workloads.length > 0 ? preference.workloads.map((item) => workloadLabels[item]).join(', ') : 'מלאה או חלקית'}
        </p>
      )}
      {preference.employmentType === 'temporary' && (
        <p>תאריכים: {preference.availableDates.map(shortDate).join(', ')}</p>
      )}
      {preference.transportOnly && <p>רק עם הסעה או מימון נסיעה</p>}
    </div>
  )
}

// Worker job-search preferences (spec §1.1 "Preferences Engine"). A worker can
// save several; the feed shows jobs that fit any of them, with flexible ranges.
export function PreferencesPanel({ profile, cities, categories, onChanged }: Props) {
  const emptyForm = useMemo<WorkerPreferenceInput>(
    () => ({
      employmentType: 'temporary',
      city: cities.some((city) => city.name === profile.city) ? profile.city : null,
      radiusKm: 15,
      minHourlyPay: 35,
      minMonthlyPay: 0,
      categories: [],
      workloads: [],
      availableDates: [],
      transportOnly: false,
    }),
    [cities, profile.city],
  )
  const [preferenceForm, setPreferenceForm] = useState<WorkerPreferenceInput>(emptyForm)
  const [preferencesMessage, setPreferencesMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const current = new Date()
    return new Date(current.getFullYear(), current.getMonth(), 1)
  })

  const savedPreferences = profile.preferences
  const formIsTemporary = preferenceForm.employmentType === 'temporary'
  const activeCategories = categories.filter((category) => category.isActive)

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear()
    const month = calendarMonth.getMonth()
    const startWeekDay = new Date(year, month, 1).getDay()
    const totalDays = new Date(year, month + 1, 0).getDate()
    const cells: Array<Date | null> = []

    for (let i = 0; i < startWeekDay; i += 1) {
      cells.push(null)
    }

    for (let day = 1; day <= totalDays; day += 1) {
      cells.push(new Date(year, month, day))
    }

    return cells
  }, [calendarMonth])

  const today = dateKey(new Date())

  const updatePreferenceForm = (patch: Partial<WorkerPreferenceInput>) => {
    setPreferenceForm((previous) => ({ ...previous, ...patch }))
    setPreferencesMessage('')
    setError('')
  }

  const toggleAvailabilityDate = (selectedDate: Date) => {
    updatePreferenceForm({
      availableDates: toggleValue(preferenceForm.availableDates, dateKey(selectedDate)).sort(),
    })
  }

  const changeMonth = (direction: -1 | 1) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1))
  }

  const addWorkerPreference = async () => {
    if (formIsTemporary && preferenceForm.availableDates.length === 0) {
      setError('למשרה זמנית צריך לבחור לפחות תאריך אחד בלוח השנה.')
      return
    }
    setSaving(true)
    try {
      await api.addWorkerPreference(preferenceForm)
      setPreferenceForm(emptyForm)
      setPreferencesMessage('ההעדפה נשמרה. אפשר להוסיף עוד העדפות.')
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'שמירת ההעדפה נכשלה.'))
    } finally {
      setSaving(false)
    }
  }

  const removeWorkerPreference = async (preferenceId: number) => {
    try {
      await api.deleteWorkerPreference(preferenceId)
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'מחיקת ההעדפה נכשלה.'))
    }
  }

  return (
    <section className="panel worker-grid preferences-layout">
      <article className="card saved-preferences">
        <h2>ההעדפות השמורות שלי</h2>
        {savedPreferences.length === 0 ? (
          <p className="empty">עדיין לא נשמרו העדפות, לכן מוצגות כל המשרות.</p>
        ) : (
          <>
            <p className="empty">
              בפיד יופיעו משרות שמתאימות לאחת לפחות מההעדפות. גם משרות קרובות (מעט מחוץ לטווח או מעט מתחת לשכר) יוצגו,
              עם סימון, כדי שאפשר יהיה לסגור פרטים בצ׳אט.
            </p>
            <div className="preference-cards">
              {savedPreferences.map((preference) => (
                <div key={preference.id} className="list-item">
                  <PreferenceSummary preference={preference} />
                  <button type="button" className="ghost" onClick={() => void removeWorkerPreference(preference.id)}>
                    הסרה
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </article>

      <article className="card filters">
        <h2>{savedPreferences.length === 0 ? 'הוספת העדפה' : 'הוספת העדפה נוספת'}</h2>
        <div className="choice-group">
          <span>סוג משרה</span>
          <div className="pill-row">
            {(['temporary', 'permanent'] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={`pill ${preferenceForm.employmentType === type ? 'selected' : ''}`}
                onClick={() => updatePreferenceForm({ employmentType: type })}
              >
                {employmentTypeLabels[type]}
              </button>
            ))}
          </div>
        </div>
        <label>
          מיקום
          <select
            value={preferenceForm.city ?? ''}
            onChange={(event) => updatePreferenceForm({ city: event.target.value || null })}
          >
            <option value="">המיקום שבפרופיל ({profile.locationLabel ?? profile.city})</option>
            {cities.map((city) => (
              <option key={city.name}>{city.name}</option>
            ))}
          </select>
        </label>
        <label>
          מרחק מקסימלי: עד {preferenceForm.radiusKm} ק״מ
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={preferenceForm.radiusKm}
            onChange={(event) => updatePreferenceForm({ radiusKm: Number(event.target.value) })}
          />
        </label>
        <label>
          שכר מינימלי לשעה: {preferenceForm.minHourlyPay} ש"ח
          <input
            type="range"
            min={35}
            max={120}
            step={1}
            value={preferenceForm.minHourlyPay}
            onChange={(event) => updatePreferenceForm({ minHourlyPay: Number(event.target.value) })}
          />
        </label>
        {!formIsTemporary && (
          <>
            <label>
              שכר חודשי מבוקש:{' '}
              {preferenceForm.minMonthlyPay > 0 ? `${preferenceForm.minMonthlyPay.toLocaleString('he-IL')} ש"ח` : 'ללא דרישה'}
              <input
                type="range"
                min={0}
                max={30000}
                step={500}
                value={preferenceForm.minMonthlyPay}
                onChange={(event) => updatePreferenceForm({ minMonthlyPay: Number(event.target.value) })}
              />
            </label>
            <div className="choice-group">
              <span>היקף משרה (בלי בחירה = שניהם)</span>
              <div className="pill-row">
                {(['full', 'part'] as Workload[]).map((workload) => (
                  <button
                    key={workload}
                    type="button"
                    className={`pill ${preferenceForm.workloads.includes(workload) ? 'selected' : ''}`}
                    onClick={() => updatePreferenceForm({ workloads: toggleValue(preferenceForm.workloads, workload) })}
                  >
                    {workloadLabels[workload]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="choice-group">
          <span>תחומי עיסוק</span>
          <div className="pill-row">
            <button
              type="button"
              className={`pill ${preferenceForm.categories.length === 0 ? 'selected' : ''}`}
              onClick={() => updatePreferenceForm({ categories: [] })}
            >
              פתוח/ה לכל התחומים
            </button>
            {activeCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`pill ${preferenceForm.categories.includes(category.name) ? 'selected' : ''}`}
                onClick={() => updatePreferenceForm({ categories: toggleValue(preferenceForm.categories, category.name) })}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
        <label className="inline">
          <input
            type="checkbox"
            checked={preferenceForm.transportOnly}
            onChange={(event) => updatePreferenceForm({ transportOnly: event.target.checked })}
          />
          רק משרות עם הסעה או מימון נסיעה
        </label>
        {formIsTemporary && <p className="empty">סומנו {preferenceForm.availableDates.length} תאריכים בלוח השנה</p>}
        <button type="button" className="primary" onClick={() => void addWorkerPreference()} disabled={saving}>
          {saving ? 'שומר...' : 'שמירת העדפה'}
        </button>
        {preferencesMessage && <p className="status-box">{preferencesMessage}</p>}
        {error && <p className="error-text">{error}</p>}
      </article>

      {formIsTemporary && (
        <article className="card calendar-card">
          <p className="empty">בחרו את התאריכים שבהם אתם זמינים למשרות זמניות.</p>
          <div className="calendar-head">
            <button type="button" className="ghost" onClick={() => changeMonth(-1)}>
              חודש קודם
            </button>
            <h2>
              {monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
            </h2>
            <button type="button" className="ghost" onClick={() => changeMonth(1)}>
              חודש הבא
            </button>
          </div>
          <div className="calendar-grid calendar-days-names">
            {dayNames.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid calendar-days">
            {calendarDays.map((day, index) => {
              if (!day) {
                return <span key={`empty-${index}`} className="calendar-empty" />
              }
              const key = dateKey(day)
              const selected = preferenceForm.availableDates.includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  className={`calendar-day ${selected ? 'selected' : ''}`}
                  onClick={() => toggleAvailabilityDate(day)}
                  disabled={key < today}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>
          <div className="pill-row">
            {preferenceForm.availableDates.slice(0, 8).map((date) => (
              <span key={date} className="pill">
                {shortDate(date)}
              </span>
            ))}
          </div>
        </article>
      )}
    </section>
  )
}
