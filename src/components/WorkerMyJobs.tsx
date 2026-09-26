import { useState } from 'react'
import { api } from '../api'
import {
  employmentTypeLabels,
  formatDate,
  formatDateTime,
  formatJobPay,
  formatPay,
  formatTimeLeft,
  stageLabels,
} from '../lib/labels'
import { errorMessage, useNow } from '../lib/useNow'
import type { Application } from '../types'
import { ShiftLinks } from './ShiftLinks'
import { StarInput } from './StarInput'

type Props = {
  applications: Application[]
  onChanged: () => void
  onOpenChat: (applicationId: number) => void
}

// Reliability deduction for canceling now (spec §5.1).
const cancelPenalty = (startsAt: string, now: number) => {
  const hours = (new Date(startsAt).getTime() - now) / 3600000
  if (hours < 4) return 20
  if (hours < 24) return 10
  return 0
}

function EmployerReviewForm({ application, onDone }: { application: Application; onDone: () => void }) {
  const [scores, setScores] = useState({ payment: 0, environment: 0, clarity: 0 })
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async () => {
    if (!scores.payment || !scores.environment || !scores.clarity) {
      setError('יש לדרג את שלושת הפרמטרים.')
      return
    }
    setSending(true)
    try {
      await api.submitReview(application.id, { ...scores, comment })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught, 'שליחת הדירוג נכשלה.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="status-box">
      <strong>דירוג {application.employer.name}</strong>
      <StarInput label="דיוק בתשלום ובתנאים" value={scores.payment} onChange={(payment) => setScores({ ...scores, payment })} />
      <StarInput label="יחס וסביבת עבודה" value={scores.environment} onChange={(environment) => setScores({ ...scores, environment })} />
      <StarInput label="בהירות ההנחיות" value={scores.clarity} onChange={(clarity) => setScores({ ...scores, clarity })} />
      <label>
        הערה (לא חובה)
        <input value={comment} onChange={(event) => setComment(event.target.value)} />
      </label>
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="primary" onClick={() => void submit()} disabled={sending}>
        שליחת דירוג
      </button>
    </div>
  )
}

// "My jobs" for workers (spec §6.3): pending offers, upcoming shifts, waitlists,
// active matches and history.
export function WorkerMyJobs({ applications, onChanged, onOpenChat }: Props) {
  const now = useNow(15000)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [cancelingId, setCancelingId] = useState<number | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const byStage = (...stages: Application['stage'][]) => applications.filter((item) => stages.includes(item.stage))
  const offers = byStage('offered')
  const upcoming = byStage('hired').sort((a, b) => (a.offer?.startsAt ?? '').localeCompare(b.offer?.startsAt ?? ''))
  const waitlisted = byStage('waitlisted')
  const matched = byStage('matched')
  const liked = byStage('liked')
  const history = byStage('completed', 'no_show', 'canceled', 'declined').filter((item) => item.matchedAt || item.stage !== 'declined')

  const run = async (applicationId: number, action: () => Promise<unknown>, success: string) => {
    setBusyId(applicationId)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'הפעולה נכשלה.'))
    } finally {
      setBusyId(null)
    }
  }

  const empty = applications.length === 0

  return (
    <section className="panel employer-grid">
      {(error || notice) && (
        <article className="card full-row">
          {error && <p className="error-text">{error}</p>}
          {notice && <p className="status-box">{notice}</p>}
        </article>
      )}

      {empty && (
        <article className="card full-row">
          <h2>המשרות שלי</h2>
          <p className="empty">עוד אין כאן כלום. החליקו ימינה על משרות בפיד, וכשגם המעסיק יסמן אתכם ייווצר Match.</p>
        </article>
      )}

      {offers.length > 0 && (
        <article className="card full-row highlight">
          <h2>הצעות עבודה שממתינות לך</h2>
          <div className="list">
            {offers.map((item) => item.offer && (
              <div key={item.id} className="list-item">
                <strong>
                  {item.offer.fromWaitlist ? 'תקן התפנה! ' : ''}
                  {item.job.title} · {item.employer.name}
                </strong>
                <span>
                  {formatDateTime(item.offer.startsAt)} · {item.offer.address}
                </span>
                <span>{formatPay(item.offer.payType, item.offer.payAmount)}</span>
                {item.offer.conditions && <span>תנאים: {item.offer.conditions}</span>}
                <span className="countdown">{formatTimeLeft(item.offer.expiresAt, now)}</span>
                <div className="fit-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busyId === item.id}
                    onClick={() =>
                      void run(item.id, async () => {
                        const stage = await api.respondJobOffer(item.offer!.id, true)
                        if (stage === 'waitlisted') throw new Error('המשרה התמלאה ברגע האחרון. נכנסת לרשימת ההמתנה.')
                      }, 'שובצת! קישור לטופס 101 נשלח בצ׳אט.')
                    }
                  >
                    אישור
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busyId === item.id}
                    onClick={() => void run(item.id, () => api.respondJobOffer(item.offer!.id, false), 'ההצעה נדחתה.')}
                  >
                    דחייה
                  </button>
                  <button type="button" className="ghost" onClick={() => onOpenChat(item.id)}>
                    צ׳אט
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>
      )}

      {upcoming.length > 0 && (
        <article className="card full-row">
          <h2>משמרות קרובות</h2>
          <div className="list">
            {upcoming.map((item) => {
              const penalty = item.offer ? cancelPenalty(item.offer.startsAt, now) : 0
              return (
                <div key={item.id} className="list-item">
                  <strong>
                    {item.job.title} · {item.employer.name}
                  </strong>
                  {item.offer && (
                    <>
                      <span>
                        {formatDateTime(item.offer.startsAt)}–{formatDateTime(item.offer.endsAt).split(' ').pop()} · {item.offer.address}
                      </span>
                      <span>{formatPay(item.offer.payType, item.offer.payAmount)}</span>
                    </>
                  )}
                  <ShiftLinks application={item} />
                  <div className="fit-actions">
                    <button type="button" className="ghost" onClick={() => onOpenChat(item.id)}>
                      צ׳אט
                    </button>
                    <button type="button" className="ghost" onClick={() => setCancelingId(cancelingId === item.id ? null : item.id)}>
                      ביטול הגעה
                    </button>
                  </div>
                  {cancelingId === item.id && (
                    <div className="status-box">
                      <p>
                        {penalty > 0
                          ? `ביטול עכשיו יוריד ${penalty} נקודות ממדד האמינות שלך.`
                          : 'ביטול יותר מ-24 שעות מראש לא מוריד נקודות, אבל נרשם בהיסטוריה.'}
                      </p>
                      <label>
                        סיבת הביטול
                        <input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
                      </label>
                      <button
                        type="button"
                        className="primary"
                        disabled={busyId === item.id || cancelReason.trim().length < 2}
                        onClick={() =>
                          void run(item.id, () => api.cancelHire(item.id, cancelReason.trim()), 'ההגעה בוטלה.').then(() => {
                            setCancelingId(null)
                            setCancelReason('')
                          })
                        }
                      >
                        אישור ביטול
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </article>
      )}

      {waitlisted.length > 0 && (
        <article className="card">
          <h2>רשימות המתנה</h2>
          <p className="empty">אם יתפנה מקום, תקבלו הודעה ויהיו לכם 10 דקות לאשר.</p>
          <div className="list">
            {waitlisted.map((item) => (
              <div key={item.id} className="list-item">
                <strong>{item.job.title}</strong>
                <span>{item.employer.name}</span>
                <span>מקום בתור: {item.waitlistPosition ?? '—'}</span>
              </div>
            ))}
          </div>
        </article>
      )}

      {matched.length > 0 && (
        <article className="card">
          <h2>Match פעיל</h2>
          <div className="list">
            {matched.map((item) => (
              <div key={item.id} className="list-item fit">
                <div>
                  <strong>{item.job.title}</strong>
                  <p>
                    {item.employer.name} · {formatJobPay(item.job)}
                  </p>
                </div>
                <button type="button" className="primary" onClick={() => onOpenChat(item.id)}>
                  לצ׳אט
                </button>
              </div>
            ))}
          </div>
        </article>
      )}

      {liked.length > 0 && (
        <article className="card">
          <h2>סימנתי עניין</h2>
          <p className="empty">ממתין לתגובת המעסיק. כשגם הוא יסמן אותך ייפתח צ׳אט.</p>
          <div className="list">
            {liked.map((item) => (
              <div key={item.id} className="list-item">
                <strong>{item.job.title}</strong>
                <span>
                  {item.employer.name} · {employmentTypeLabels[item.job.employmentType]} · {formatDate(item.job.date)}
                </span>
              </div>
            ))}
          </div>
        </article>
      )}

      {history.length > 0 && (
        <article className="card full-row">
          <h2>היסטוריית עבודות</h2>
          <div className="list">
            {history.map((item) => (
              <div key={item.id} className="list-item">
                <strong>
                  {item.job.title} · {item.employer.name}
                </strong>
                <span>
                  {stageLabels[item.stage]}
                  {item.arrivedLate && ' (איחור)'}
                  {item.offer?.status === 'accepted' && ` · ${formatDateTime(item.offer.startsAt)}`}
                </span>
                {item.cancellationReason && <small>סיבת ביטול: {item.cancellationReason}</small>}
                {item.declineReason && <small>{item.declineReason}</small>}
                {item.stage === 'completed' && !item.reviewedByMe && (
                  reviewingId === item.id ? (
                    <EmployerReviewForm
                      application={item}
                      onDone={() => {
                        setReviewingId(null)
                        setNotice('תודה על הדירוג!')
                        onChanged()
                      }}
                    />
                  ) : (
                    <button type="button" className="ghost" onClick={() => setReviewingId(item.id)}>
                      דרגו את המעסיק
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  )
}
