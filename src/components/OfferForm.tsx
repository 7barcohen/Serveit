import { useState } from 'react'
import { api } from '../api'
import { errorMessage } from '../lib/useNow'
import type { Application, OfferPayType } from '../types'

type Props = {
  application: Application
  onSent: () => void
  onCancel: () => void
}

const responseOptions = [
  { minutes: 30, label: '30 דקות (משמרת דחופה)' },
  { minutes: 120, label: 'שעתיים' },
  { minutes: 720, label: '12 שעות' },
  { minutes: 1440, label: '24 שעות' },
  { minutes: 4320, label: '3 ימים' },
]

const defaultTimes = { morning: ['07:00', '15:00'], afternoon: ['12:00', '20:00'], evening: ['17:00', '23:00'], night: ['23:00', '07:00'] }

// Formal job offer (spec §3.2): exact date and hours, exact address, hourly or
// global rate, special conditions and a response deadline.
export function OfferForm({ application, onSent, onCancel }: Props) {
  const [startTime, endTime] = defaultTimes[application.job.shift]
  const [form, setForm] = useState({
    date: application.job.date,
    startTime,
    endTime,
    address: '',
    payType: (application.job.payType === 'hourly' ? 'hourly' : 'global') as OfferPayType,
    payAmount: application.job.hourlyPay ?? application.job.monthlyPay ?? 0,
    conditions: '',
    responseMinutes: 1440,
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const update = (patch: Partial<typeof form>) => setForm((previous) => ({ ...previous, ...patch }))

  const submit = async () => {
    const startsAt = new Date(`${form.date}T${form.startTime}`)
    const endsAt = new Date(`${form.date}T${form.endTime}`)
    // Overnight shifts end the next day.
    if (endsAt <= startsAt) {
      endsAt.setDate(endsAt.getDate() + 1)
    }
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setError('מועד ההתחלה חייב להיות בעתיד.')
      return
    }
    if (form.address.trim().length < 5) {
      setError('יש להזין כתובת מדויקת.')
      return
    }
    if (!(form.payAmount > 0)) {
      setError('יש להזין תעריף.')
      return
    }

    setSending(true)
    setError('')
    try {
      await api.sendJobOffer({
        applicationId: application.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        address: form.address.trim(),
        payType: form.payType,
        payAmount: form.payAmount,
        conditions: form.conditions.trim(),
        responseMinutes: form.responseMinutes,
      })
      onSent()
    } catch (caught) {
      setError(errorMessage(caught, 'שליחת ההצעה נכשלה.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="status-box offer-form">
      <h3>הצעת עבודה רשמית ל{application.worker.firstName}</h3>
      <div className="form-grid">
        <label>
          תאריך
          <input type="date" value={form.date} onChange={(event) => update({ date: event.target.value })} />
        </label>
        <label>
          משעה
          <input type="time" value={form.startTime} onChange={(event) => update({ startTime: event.target.value })} />
        </label>
        <label>
          עד שעה
          <input type="time" value={form.endTime} onChange={(event) => update({ endTime: event.target.value })} />
        </label>
        <label>
          כתובת מדויקת
          <input
            value={form.address}
            placeholder="רחוב, מספר, עיר"
            onChange={(event) => update({ address: event.target.value })}
          />
        </label>
        <label>
          סוג תעריף
          <select value={form.payType} onChange={(event) => update({ payType: event.target.value as OfferPayType })}>
            <option value="hourly">שעתי</option>
            <option value="global">גלובלי</option>
          </select>
        </label>
        <label>
          תעריף (₪)
          <input
            type="number"
            min={1}
            value={form.payAmount}
            onChange={(event) => update({ payAmount: Number(event.target.value) })}
          />
        </label>
        <label>
          זמן לתשובה
          <select value={form.responseMinutes} onChange={(event) => update({ responseMinutes: Number(event.target.value) })}>
            {responseOptions.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          תנאים מיוחדים
          <input
            value={form.conditions}
            placeholder="לבוש נדרש, ארוחות, חניה..."
            onChange={(event) => update({ conditions: event.target.value })}
          />
        </label>
      </div>
      <p className="empty">עם אישור העובד/ת יישלח אוטומטית קישור לטופס 101 שהוגדר בפרופיל החברה.</p>
      {error && <p className="error-text">{error}</p>}
      <div className="swipe-actions">
        <button type="button" className="primary" onClick={() => void submit()} disabled={sending}>
          {sending ? 'שולח...' : 'שלח הצעה'}
        </button>
        <button type="button" className="ghost" onClick={onCancel} disabled={sending}>
          ביטול
        </button>
      </div>
    </div>
  )
}
