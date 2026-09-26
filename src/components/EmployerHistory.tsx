import { useState } from 'react'
import { api } from '../api'
import { formatDateTime, formatPay, stageLabels } from '../lib/labels'
import { errorMessage } from '../lib/useNow'
import type { Application, ManagedJob } from '../types'
import { StarInput } from './StarInput'

type Props = {
  jobs: ManagedJob[]
  applications: Application[]
  onChanged: () => void
  onOpenChat: (applicationId: number) => void
}

const hoursBetween = (start: string, end: string) =>
  Math.round(((new Date(end).getTime() - new Date(start).getTime()) / 3600000) * 10) / 10

// Employer work history log + fast re-hire (spec §6.1).
export function EmployerHistory({ jobs, applications, onChanged, onOpenChat }: Props) {
  const [paidDrafts, setPaidDrafts] = useState<Record<number, string>>({})
  const [reviewDrafts, setReviewDrafts] = useState<Record<number, { score: number; comment: string }>>({})
  const [rehireJob, setRehireJob] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const history = applications
    .filter((item) => item.stage === 'completed' || item.stage === 'no_show' || (item.stage === 'canceled' && item.offer?.status === 'accepted'))
    .sort((a, b) => (b.offer?.startsAt ?? b.createdAt).localeCompare(a.offer?.startsAt ?? a.createdAt))

  const pastWorkers = [...new Map(
    applications.filter((item) => item.stage === 'completed').map((item) => [item.workerId, item]),
  ).values()]
  const openJobs = jobs.filter((job) => job.status !== 'closed')

  const totals = history.reduce(
    (sum, item) => {
      if (item.stage !== 'completed' || !item.offer) return sum
      const hours = hoursBetween(item.offer.startsAt, item.offer.endsAt)
      const agreed = item.offer.payType === 'hourly' ? hours * item.offer.payAmount : item.offer.payAmount
      return { hours: sum.hours + hours, agreed: sum.agreed + agreed, paid: sum.paid + (item.paidAmount ?? 0) }
    },
    { hours: 0, agreed: 0, paid: 0 },
  )

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'הפעולה נכשלה.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel employer-grid">
      {(error || notice) && (
        <article className="card full-row">
          {error && <p className="error-text">{error}</p>}
          {notice && <p className="status-box">{notice}</p>}
        </article>
      )}

      <article className="card full-row">
        <h2>יומן היסטוריית העסקה</h2>
        <div className="pulse-stats">
          <span>{Math.round(totals.hours)} שעות עבודה</span>
          <span>שכר מוסכם: ₪{Math.round(totals.agreed).toLocaleString('he-IL')}</span>
          <span>שולם בפועל: ₪{totals.paid.toLocaleString('he-IL')}</span>
        </div>
        {history.length === 0 ? (
          <p className="empty">משמרות שהסתיימו יופיעו כאן עם שעות, שכר מוסכם ותשלום בפועל.</p>
        ) : (
          <div className="table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>עובד/ת</th>
                  <th>משרה</th>
                  <th>שעות</th>
                  <th>שכר מוסכם</th>
                  <th>שולם בפועל</th>
                  <th>סטטוס</th>
                  <th>דירוג</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => {
                  const offer = item.offer
                  const hours = offer ? hoursBetween(offer.startsAt, offer.endsAt) : 0
                  const review = reviewDrafts[item.id] ?? { score: 0, comment: '' }
                  return (
                    <tr key={item.id}>
                      <td>{offer ? formatDateTime(offer.startsAt) : '—'}</td>
                      <td>{item.worker.firstName}</td>
                      <td>{item.job.title}</td>
                      <td>{hours || '—'}</td>
                      <td>{offer ? formatPay(offer.payType, offer.payAmount) : '—'}</td>
                      <td>
                        {item.stage === 'completed' ? (
                          <div className="inline">
                            <input
                              type="number"
                              min={0}
                              className="compact-input"
                              aria-label="סכום ששולם"
                              value={paidDrafts[item.id] ?? item.paidAmount ?? ''}
                              onChange={(event) => setPaidDrafts({ ...paidDrafts, [item.id]: event.target.value })}
                            />
                            <button
                              type="button"
                              className="ghost"
                              disabled={busy || paidDrafts[item.id] === undefined || paidDrafts[item.id] === ''}
                              onClick={() =>
                                void run(() => api.recordPayment(item.id, Number(paidDrafts[item.id])), 'התשלום נשמר.')
                              }
                            >
                              שמירה
                            </button>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {stageLabels[item.stage]}
                        {item.arrivedLate && ' (איחור)'}
                      </td>
                      <td>
                        {item.stage !== 'completed' ? (
                          '—'
                        ) : item.reviewedByMe ? (
                          'דורג'
                        ) : (
                          <div className="review-cell">
                            <StarInput
                              label="דירוג העובד/ת"
                              value={review.score}
                              onChange={(score) => setReviewDrafts({ ...reviewDrafts, [item.id]: { ...review, score } })}
                            />
                            <button
                              type="button"
                              className="ghost"
                              disabled={busy || !review.score}
                              onClick={() =>
                                void run(() => api.submitReview(item.id, { score: review.score, comment: review.comment }), 'הדירוג נשמר.')
                              }
                            >
                              שליחה
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="card full-row">
        <h2>גיוס חוזר מהיר</h2>
        <p className="empty">
          הציעו עבודה ישירות לעובדים שכבר עבדו אצלכם, גם אם התחום או המשרה לא מופיעים כרגע בהעדפות שלהם. ייפתח צ׳אט, ומשם אפשר
          לשלוח הצעה.
        </p>
        {pastWorkers.length === 0 && <p className="empty">עובדים שהשלימו אצלכם משמרת יופיעו כאן.</p>}
        <div className="list">
          {pastWorkers.map((item) => (
            <div key={item.workerId} className="list-item fit">
              <div>
                <strong>{item.worker.firstName}</strong>
                <p>
                  מדד אמינות {item.worker.reliabilityScore} · עבד/ה אצלכם ב"{item.job.title}"
                </p>
              </div>
              <div className="fit-actions">
                <select
                  aria-label="משרה להצעה"
                  value={rehireJob[item.workerId] ?? openJobs[0]?.id ?? ''}
                  onChange={(event) => setRehireJob({ ...rehireJob, [item.workerId]: Number(event.target.value) })}
                >
                  {openJobs.length === 0 && <option value="">אין משרה פתוחה</option>}
                  {openJobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || openJobs.length === 0}
                  onClick={() =>
                    void run(async () => {
                      const applicationId = await api.rehireWorker(item.workerId, rehireJob[item.workerId] ?? openJobs[0].id)
                      onOpenChat(applicationId)
                    }, `${item.worker.firstName} הוזמן/ה שוב. הצ׳אט נפתח.`)
                  }
                >
                  הצעת עבודה
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}
