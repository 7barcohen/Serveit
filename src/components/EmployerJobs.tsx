import { useState } from 'react'
import { api } from '../api'
import {
  employmentTypeLabels,
  formatDate,
  formatDateTime,
  formatJobPay,
  formatPay,
  formatTimeLeft,
  shiftLabels,
  shiftOptions,
  workloadLabels,
} from '../lib/labels'
import { errorMessage, useNow } from '../lib/useNow'
import type {
  Application,
  City,
  EmployerPlan,
  EmployerProfile,
  EmploymentType,
  JobCategory,
  ManagedJob,
  PayType,
  ShiftWindow,
  Workload,
} from '../types'

type Props = {
  profile: EmployerProfile
  hasAccess: boolean
  jobs: ManagedJob[]
  applications: Application[]
  cities: City[]
  categories: JobCategory[]
  plans: EmployerPlan[]
  onChanged: () => void
  onOpenCandidates: (jobId: number) => void
  onOpenChat: (applicationId: number) => void
  onOpenCompany: () => void
}

const statusLabels = { open: 'פתוחה', filled: 'מלאה', closed: 'סגורה' } as const

const tomorrow = () => {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

const emptyForm = () => ({
  employmentType: 'temporary' as EmploymentType,
  title: '',
  category: '',
  city: 'תל אביב',
  date: tomorrow(),
  shift: 'evening' as ShiftWindow,
  payType: 'hourly' as PayType,
  hourlyPay: 60,
  monthlyPay: 9000,
  workload: 'full' as Workload,
  requiredWorkers: 1,
  description: '',
  transportOffered: false,
  transportFrom: '',
})

// "My jobs" for employers (spec §4, §6.3): publishing, shift caps, hires,
// waitlists, shift outcomes and documents.
export function EmployerJobs({
  profile,
  hasAccess,
  jobs,
  applications,
  cities,
  categories,
  plans,
  onChanged,
  onOpenCandidates,
  onOpenChat,
  onOpenCompany,
}: Props) {
  const now = useNow(30000)
  const [publishForm, setPublishForm] = useState(emptyForm)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null)
  const [cancelState, setCancelState] = useState<{ applicationId: number; reason: string } | null>(null)
  const [docJobId, setDocJobId] = useState(0)
  const [docLink, setDocLink] = useState('')
  const [busy, setBusy] = useState(false)

  const activeCategories = categories.filter((category) => category.isActive)
  const category = publishForm.category || activeCategories[0]?.name || ''
  const activePlan = plans.find((plan) => plan.dbId === profile.activePlanId) ?? null
  const usedOpenings = jobs.filter((job) => job.status !== 'closed').length
  const canPublish = profile.isVerified && hasAccess

  const appsFor = (jobId: number, ...stages: Application['stage'][]) =>
    applications.filter((item) => item.jobId === jobId && stages.includes(item.stage))

  const documentEligibleJobs = jobs.filter((job) => appsFor(job.id, 'hired', 'completed').length > 0)
  const effectiveDocJobId = documentEligibleJobs.some((job) => job.id === docJobId) ? docJobId : documentEligibleJobs[0]?.id ?? 0

  const updateForm = (patch: Partial<ReturnType<typeof emptyForm>>) => setPublishForm((previous) => ({ ...previous, ...patch }))

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

  const publishJob = async () => {
    if (publishForm.title.trim().length < 2) {
      setError('יש להזין כותרת למשרה.')
      return
    }
    if (publishForm.employmentType === 'temporary' && publishForm.date < new Date().toISOString().slice(0, 10)) {
      setError('יש לבחור תאריך עתידי.')
      return
    }
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      const isPermanent = publishForm.employmentType === 'permanent'
      await api.createJob({
        title: publishForm.title.trim(),
        category,
        city: publishForm.city,
        employmentType: publishForm.employmentType,
        date: publishForm.date,
        shift: publishForm.shift,
        payType: publishForm.payType,
        hourlyPay: publishForm.payType === 'hourly' ? publishForm.hourlyPay : null,
        monthlyPay: publishForm.payType === 'monthly' ? publishForm.monthlyPay : null,
        workload: isPermanent ? publishForm.workload : null,
        requiredWorkers: publishForm.requiredWorkers,
        description: publishForm.description.trim(),
        transportOffered: publishForm.transportOffered,
        transportFrom: publishForm.transportFrom.trim() || undefined,
      })
      setPublishForm((previous) => ({ ...emptyForm(), city: previous.city, category: previous.category }))
      setNotice('המשרה פורסמה. עובדים מתאימים קיבלו התראה.')
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught, 'פרסום המשרה נכשל. בדקו את הנתונים ונסו שוב.'))
    } finally {
      setPublishing(false)
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

      <article className="card">
        <h2>פרסום משרה חדשה</h2>
        {!profile.isVerified && (
          <div className="status-box">
            <p>
              {profile.verificationRequestedAt
                ? 'אימות העסק ממתין לאישור צוות WorkAway. אפשר יהיה לפרסם מיד אחרי האישור.'
                : 'לפני פרסום משרות יש להשלים אימות עסק (ח.פ. / עוסק מורשה).'}
            </p>
            <button type="button" className="ghost" onClick={onOpenCompany}>
              לפרופיל החברה
            </button>
          </div>
        )}
        {profile.isVerified && !hasAccess && (
          <div className="status-box">
            <p>תקופת הניסיון הסתיימה. כדי לפרסם ולגייס יש לבחור מסלול.</p>
            <button type="button" className="ghost" onClick={onOpenCompany}>
              לבחירת מסלול
            </button>
          </div>
        )}
        <fieldset disabled={!canPublish || publishing} className="plain-fieldset">
          <div className="form-grid">
            <label>
              סוג משרה
              <select
                value={publishForm.employmentType}
                onChange={(event) => {
                  const employmentType = event.target.value as EmploymentType
                  updateForm({ employmentType, payType: employmentType === 'permanent' ? 'monthly' : 'hourly' })
                }}
              >
                <option value="temporary">{employmentTypeLabels.temporary}</option>
                <option value="permanent">{employmentTypeLabels.permanent}</option>
              </select>
            </label>
            <label>
              תפקיד / כותרת
              <input value={publishForm.title} maxLength={120} onChange={(event) => updateForm({ title: event.target.value })} />
            </label>
            <label>
              תחום
              <select value={category} onChange={(event) => updateForm({ category: event.target.value })}>
                {activeCategories.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>
              עיר
              <select value={publishForm.city} onChange={(event) => updateForm({ city: event.target.value })}>
                {cities.map((city) => (
                  <option key={city.name}>{city.name}</option>
                ))}
              </select>
            </label>
            <label>
              {publishForm.employmentType === 'permanent' ? 'תאריך תחילת עבודה' : 'תאריך המשמרת'}
              <input type="date" value={publishForm.date} onChange={(event) => updateForm({ date: event.target.value })} />
            </label>
            <label>
              חלון שעות
              <select value={publishForm.shift} onChange={(event) => updateForm({ shift: event.target.value as ShiftWindow })}>
                {shiftOptions.map((shift) => (
                  <option key={shift} value={shift}>
                    {shiftLabels[shift]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              סוג שכר
              <select value={publishForm.payType} onChange={(event) => updateForm({ payType: event.target.value as PayType })}>
                <option value="hourly">שעתי</option>
                <option value="monthly">חודשי</option>
              </select>
            </label>
            {publishForm.payType === 'hourly' ? (
              <label>
                שכר לשעה (₪)
                <input
                  type="number"
                  min={30}
                  value={publishForm.hourlyPay}
                  onChange={(event) => updateForm({ hourlyPay: Number(event.target.value) })}
                />
              </label>
            ) : (
              <label>
                שכר חודשי (₪)
                <input
                  type="number"
                  min={1000}
                  step={100}
                  value={publishForm.monthlyPay}
                  onChange={(event) => updateForm({ monthlyPay: Number(event.target.value) })}
                />
              </label>
            )}
            {publishForm.employmentType === 'permanent' && (
              <label>
                היקף משרה
                <select value={publishForm.workload} onChange={(event) => updateForm({ workload: event.target.value as Workload })}>
                  <option value="full">{workloadLabels.full}</option>
                  <option value="part">{workloadLabels.part}</option>
                </select>
              </label>
            )}
            <label>
              {publishForm.employmentType === 'temporary' ? 'מספר עובדים נדרש (מכסה)' : 'מספר משרות'}
              <input
                type="number"
                min={1}
                max={500}
                value={publishForm.requiredWorkers}
                onChange={(event) => updateForm({ requiredWorkers: Number(event.target.value) })}
              />
            </label>
          </div>
          <label>
            תיאור המשרה
            <textarea
              rows={3}
              maxLength={1500}
              value={publishForm.description}
              onChange={(event) => updateForm({ description: event.target.value })}
              placeholder="מה עושים, דרישות, מה מקבלים"
            />
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={publishForm.transportOffered}
              onChange={(event) => updateForm({ transportOffered: event.target.checked })}
            />
            יש הסעה או מימון נסיעה
          </label>
          {publishForm.transportOffered && (
            <label>
              הסעה מ-
              <input value={publishForm.transportFrom} onChange={(event) => updateForm({ transportFrom: event.target.value })} />
            </label>
          )}
          <p className="empty">טלפונים, מיילים וקישורים בתיאור מוסתרים אוטומטית.</p>
          <button type="button" className="primary" onClick={() => void publishJob()}>
            {publishing ? 'מפרסם...' : 'פרסם משרה'}
          </button>
        </fieldset>
      </article>

      <article className="card">
        <h2>מסלול ומכסה</h2>
        <p>
          {activePlan ? (
            <>
              <strong>{activePlan.name}</strong> · ניצול {usedOpenings}/{activePlan.openingsLimit} משרות פעילות
            </>
          ) : (
            `תקופת ניסיון: ${usedOpenings} משרות פעילות, ללא הגבלה עד ${formatDate(profile.trialEndsAt)}`
          )}
        </p>

        <h3>שליחת מסמכים</h3>
        <p className="empty">טופס 101 נשלח אוטומטית עם אישור כל הצעה. כאן אפשר לשלוח מסמכים נוספים לעובדים משובצים.</p>
        <label>
          משרה
          <select value={effectiveDocJobId} onChange={(event) => setDocJobId(Number(event.target.value))}>
            {documentEligibleJobs.length === 0 && <option value={0}>אין משרות עם עובדים משובצים</option>}
            {documentEligibleJobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          קישור למסמכים
          <input value={docLink} placeholder="https://" onChange={(event) => setDocLink(event.target.value)} />
        </label>
        <button
          type="button"
          className="primary"
          disabled={busy || effectiveDocJobId === 0}
          onClick={() =>
            void run(async () => {
              const result = await api.sendDocuments({ jobId: effectiveDocJobId, documentUrl: docLink.trim() })
              setDocLink('')
              setNotice(result.message)
            }, 'המסמכים נשלחו.')
          }
        >
          שלח מסמכים
        </button>
      </article>

      <article className="card full-row">
        <h2>המשרות שלי</h2>
        {jobs.length === 0 && <p className="empty">עדיין לא פרסמת משרות.</p>}
        <div className="list">
          {jobs.map((job) => {
            const hired = appsFor(job.id, 'hired')
            const completed = appsFor(job.id, 'completed', 'no_show')
            const waitlist = appsFor(job.id, 'waitlisted').sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))
            const offered = appsFor(job.id, 'offered')
            const matched = appsFor(job.id, 'matched')
            const liked = appsFor(job.id, 'liked')
            const filledCount = hired.length + appsFor(job.id, 'completed').length
            const expanded = expandedJobId === job.id
            const sponsored = job.sponsoredUntil && new Date(job.sponsoredUntil).getTime() > now
            return (
              <div key={job.id} className={`list-item job-row status-${job.status}`}>
                <div className="job-row-head">
                  <div>
                    <strong>{job.title}</strong>
                    <p>
                      {employmentTypeLabels[job.employmentType]}
                      {job.workload ? ` (${workloadLabels[job.workload]})` : ''} · {job.city} · {formatDate(job.date)} ·{' '}
                      {shiftLabels[job.shift]} · {formatJobPay(job)}
                    </p>
                    <p>
                      <span className={`pill status-pill ${job.status}`}>{statusLabels[job.status]}</span> איוש {filledCount}/
                      {job.requiredWorkers} · Match {matched.length} · הצעות {offered.length} · המתנה {waitlist.length} · התעניינו{' '}
                      {liked.length}
                      {sponsored ? ' · מקודמת' : ''}
                    </p>
                  </div>
                  <div className="fit-actions">
                    {job.status !== 'closed' && (
                      <button type="button" className="primary" onClick={() => onOpenCandidates(job.id)}>
                        מועמדים
                      </button>
                    )}
                    <button type="button" className="ghost" onClick={() => setExpandedJobId(expanded ? null : job.id)}>
                      {expanded ? 'הסתרה' : 'ניהול'}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="job-manage">
                    {offered.length > 0 && (
                      <>
                        <h4>הצעות ממתינות</h4>
                        {offered.map((item) => (
                          <div key={item.id} className="manage-line">
                            <span>
                              {item.worker.firstName}
                              {item.offer?.fromWaitlist ? ' (מרשימת ההמתנה)' : ''} ·{' '}
                              {item.offer ? formatTimeLeft(item.offer.expiresAt, now) : ''}
                            </span>
                            <button type="button" className="ghost" onClick={() => onOpenChat(item.id)}>
                              צ׳אט
                            </button>
                          </div>
                        ))}
                      </>
                    )}

                    <h4>משובצים</h4>
                    {hired.length === 0 && <p className="empty">אין עדיין עובדים משובצים.</p>}
                    {hired.map((item) => {
                      const started = item.offer ? new Date(item.offer.startsAt).getTime() <= now : false
                      return (
                        <div key={item.id} className="manage-line">
                          <span>
                            {item.worker.firstName} · מדד {item.worker.reliabilityScore}
                            {item.offer && ` · ${formatDateTime(item.offer.startsAt)} · ${formatPay(item.offer.payType, item.offer.payAmount)}`}
                          </span>
                          <div className="fit-actions">
                            {started ? (
                              <>
                                <button
                                  type="button"
                                  className="primary"
                                  disabled={busy}
                                  onClick={() => void run(() => api.completeShift(item.id, 'completed'), 'המשמרת סומנה כהושלמה (2+ למדד).')}
                                >
                                  הושלמה
                                </button>
                                <button
                                  type="button"
                                  className="ghost"
                                  disabled={busy}
                                  onClick={() => void run(() => api.completeShift(item.id, 'late'), 'סומן איחור (5- למדד).')}
                                >
                                  איחור 15+ דק׳
                                </button>
                                <button
                                  type="button"
                                  className="ghost"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(() => api.completeShift(item.id, 'no_show'), 'סומנה אי-הגעה (35- למדד והשעיה ל-7 ימים).')
                                  }
                                >
                                  לא הגיע/ה
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => setCancelState({ applicationId: item.id, reason: '' })}
                              >
                                ביטול שיבוץ
                              </button>
                            )}
                            <button type="button" className="ghost" onClick={() => onOpenChat(item.id)}>
                              צ׳אט
                            </button>
                          </div>
                          {cancelState?.applicationId === item.id && (
                            <div className="status-box">
                              <label>
                                סיבת הביטול
                                <input
                                  value={cancelState.reason}
                                  onChange={(event) => setCancelState({ ...cancelState, reason: event.target.value })}
                                />
                              </label>
                              <button
                                type="button"
                                className="primary"
                                disabled={busy || cancelState.reason.trim().length < 2}
                                onClick={() =>
                                  void run(() => api.cancelHire(item.id, cancelState.reason.trim()), 'השיבוץ בוטל.').then(() =>
                                    setCancelState(null),
                                  )
                                }
                              >
                                אישור ביטול
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {waitlist.length > 0 && (
                      <>
                        <h4>רשימת המתנה (לפי מדד אמינות)</h4>
                        {waitlist.map((item) => (
                          <div key={item.id} className="manage-line">
                            <span>
                              {item.waitlistPosition}. {item.worker.firstName} · מדד {item.worker.reliabilityScore}
                            </span>
                          </div>
                        ))}
                      </>
                    )}

                    {completed.length > 0 && <p className="empty">{completed.length} משמרות הסתיימו. הפירוט בלשונית "היסטוריה".</p>}

                    <div className="fit-actions">
                      {job.status !== 'closed' && (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() => void run(() => api.requestSponsorship(job.id, 7), 'בקשת הקידום נשלחה לאישור.')}
                        >
                          קידום ממומן ל-7 ימים
                        </button>
                      )}
                      {job.status !== 'closed' && (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() => void run(() => api.closeJob(job.id), 'המשרה נסגרה.')}
                        >
                          סגירת המשרה
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </article>
    </section>
  )
}
