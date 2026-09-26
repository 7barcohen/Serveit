import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { formatDate, formatDateTime, LOW_RELIABILITY, subscriptionLabels } from '../lib/labels'
import { errorMessage } from '../lib/useNow'
import type {
  AdminOverview,
  AdminUserRow,
  ContactViolationRow,
  EmployerPlan,
  JobCategory,
  PendingLicenseRow,
  SponsorshipRequestRow,
  UserReportRow,
} from '../types'

type AdminTab = 'overview' | 'users' | 'safety' | 'finance' | 'content'

const sourceLabels: Record<string, string> = {
  chat: 'צ׳אט',
  profile: 'פרופיל עובד',
  company_profile: 'פרופיל חברה',
  job_description: 'תיאור משרה',
  review: 'דירוג',
}

// Admin panel (spec §7): verification, suspensions, DLP & reports, finance,
// statistics and category management.
export function AdminPanel({ plans, categories, onCategoriesChanged }: {
  plans: EmployerPlan[]
  categories: JobCategory[]
  onCategoriesChanged: () => void
}) {
  const [tab, setTab] = useState<AdminTab>('overview')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [violations, setViolations] = useState<ContactViolationRow[]>([])
  const [reports, setReports] = useState<UserReportRow[]>([])
  const [sponsorships, setSponsorships] = useState<SponsorshipRequestRow[]>([])
  const [licenses, setLicenses] = useState<PendingLicenseRow[]>([])
  const [search, setSearch] = useState('')
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({})
  const [newCategory, setNewCategory] = useState({ name: '', requiredLicense: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [stats, userRows, violationRows, reportRows, sponsorshipRows, licenseRows] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminUsers(),
        api.getContactViolations(),
        api.getReports(),
        api.getSponsorshipRequests(),
        api.getPendingLicenses(),
      ])
      setOverview(stats)
      setUsers(userRows)
      setViolations(violationRows)
      setReports(reportRows)
      setSponsorships(sponsorshipRows)
      setLicenses(licenseRows)
      setError('')
    } catch (caught) {
      setError(errorMessage(caught, 'טעינת נתוני אדמין נכשלה.'))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
      await refresh()
    } catch (caught) {
      setError(errorMessage(caught, 'הפעולה נכשלה.'))
    } finally {
      setBusy(false)
    }
  }

  const pendingVerifications = users.filter((user) => user.employer?.verificationRequestedAt && !user.employer.isVerified)
  const filteredUsers = users.filter((user) =>
    search.trim() === ''
      ? true
      : [user.email, user.worker?.fullName, user.employer?.displayName, user.employer?.legalName]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(search.trim().toLowerCase())),
  )
  const workersByScore = users
    .filter((user) => user.worker && user.role === 'worker')
    .sort((a, b) => a.worker!.reliabilityScore - b.worker!.reliabilityScore)
  const employers = users.filter((user) => user.employer)
  const planName = (id: number | null) => plans.find((plan) => plan.dbId === id)?.name ?? '—'
  const openReports = reports.filter((report) => report.status === 'open')

  return (
    <section className="worker-shell">
      <nav className="worker-dock">
        {(
          [
            ['overview', 'סקירה'],
            ['users', 'משתמשים ואימות'],
            ['safety', `בטיחות (${openReports.length})`],
            ['finance', 'כספים וקידום'],
            ['content', 'קטגוריות'],
          ] as Array<[AdminTab, string]>
        ).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {(error || notice) && (
        <article className="card">
          {error && <p className="error-text">{error}</p>}
          {notice && <p className="status-box">{notice}</p>}
        </article>
      )}

      {tab === 'overview' && (
        <section className="panel employer-grid">
          <article className="card">
            <h2>לוג מערכת ונתונים</h2>
            {overview ? (
              <div className="stat-grid">
                <span>משתמשים: {overview.usersCount}</span>
                <span>עובדים: {overview.workersCount}</span>
                <span>מעסיקים: {overview.employersCount}</span>
                <span>מושעים: {overview.suspendedUsers}</span>
                <span>משרות: {overview.jobsCount}</span>
                <span>פתוחות: {overview.openJobs}</span>
                <span>מלאות: {overview.filledJobs}</span>
                <span>מאצ׳ים: {overview.matchesCount}</span>
                <span>שיבוצים: {overview.hiresCount}</span>
                <span>משמרות שהושלמו: {overview.completedShifts}</span>
                <span>אי-הגעות: {overview.noShows}</span>
                <span>אחוז אי-הגעה: {overview.noShowRate}%</span>
              </div>
            ) : (
              <p className="empty">טוען...</p>
            )}
            <button type="button" className="ghost" onClick={() => void refresh()}>
              רענון
            </button>
          </article>
          <article className="card">
            <h2>דורש טיפול</h2>
            {overview && (
              <div className="stat-grid">
                <span>אימותי עסקים: {overview.pendingEmployers}</span>
                <span>רישיונות לאימות: {licenses.length}</span>
                <span>דיווחים פתוחים: {overview.openReports}</span>
                <span>הפרות פרטי קשר (7 ימים): {overview.violationsLastWeek}</span>
                <span>ממתינים לתשלום: {overview.pendingPayments}</span>
                <span>בקשות קידום: {overview.pendingSponsorships}</span>
                <span>תקופות ניסיון פעילות: {overview.activeTrials}</span>
                <span>עובדים לא מאומתים: {overview.pendingWorkers}</span>
              </div>
            )}
          </article>
        </section>
      )}

      {tab === 'users' && (
        <section className="panel employer-grid">
          <article className="card full-row">
            <h2>אימות עסקים ({pendingVerifications.length})</h2>
            {pendingVerifications.length === 0 && <p className="empty">אין בקשות ממתינות.</p>}
            <div className="list">
              {pendingVerifications.map((user) => (
                <div key={user.id} className="list-item">
                  <strong>
                    {user.employer!.displayName} · {user.email}
                  </strong>
                  <span>
                    ח.פ. {user.employer!.businessId} · {user.employer!.legalName} · {user.employer!.businessAddress}
                  </span>
                  <span>
                    נציג/ה: {user.employer!.representativeName} · {user.employer!.representativePhone} · נשלח{' '}
                    {formatDate(user.employer!.verificationRequestedAt)}
                  </span>
                  <div className="fit-actions">
                    <button type="button" className="primary" disabled={busy} onClick={() => void run(() => api.verifyEmployer(user.id, true), 'העסק אומת.')}>
                      אישור
                    </button>
                    <input
                      className="compact-input wide"
                      placeholder="סיבת דחייה"
                      value={rejectNotes[user.id] ?? ''}
                      onChange={(event) => setRejectNotes({ ...rejectNotes, [user.id]: event.target.value })}
                    />
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy || !(rejectNotes[user.id] ?? '').trim()}
                      onClick={() => void run(() => api.verifyEmployer(user.id, false, rejectNotes[user.id]), 'הבקשה נדחתה.')}
                    >
                      דחייה
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <h2>רישיונות ותעודות לאימות ({licenses.length})</h2>
            {licenses.length === 0 && <p className="empty">אין רישיונות ממתינים.</p>}
            <div className="list admin-scroll">
              {licenses.map((license) => (
                <div key={license.id} className="list-item">
                  <strong>{license.name}</strong>
                  <span>
                    {license.workerEmail}
                    {license.expiresAt ? ` · בתוקף עד ${formatDate(license.expiresAt)}` : ''}
                  </span>
                  <div className="fit-actions">
                    {license.filePath && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void api.getLicenseFileUrl(license.filePath!).then((url) => window.open(url, '_blank', 'noopener'))}
                      >
                        צפייה בקובץ
                      </button>
                    )}
                    <button type="button" className="primary" disabled={busy} onClick={() => void run(() => api.verifyLicense(license.id, true), 'הרישיון אומת.')}>
                      אימות
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <h2>דוח אמינות</h2>
            <p className="empty">עובדים מהמדד הנמוך לגבוה. מתחת ל-{LOW_RELIABILITY} מסומנים.</p>
            <div className="list admin-scroll">
              {workersByScore.map((user) => (
                <div key={user.id} className={`list-item fit ${user.worker!.reliabilityScore < LOW_RELIABILITY ? 'low' : ''}`}>
                  <div>
                    <strong>{user.worker!.fullName}</strong>
                    <p>
                      {user.email} · מדד {user.worker!.reliabilityScore} · הפרות קשר {user.contactViolations}
                      {user.isSuspended ? ' · מושעה' : ''}
                    </p>
                  </div>
                  {!user.isSuspended && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => void run(() => api.setUserSuspension(user.id, true, 'מדד אמינות נמוך'), 'המשתמש הושעה.')}
                    >
                      השעיה
                    </button>
                  )}
                </div>
              ))}
            </div>
          </article>

          <article className="card full-row">
            <h2>ניהול משתמשים</h2>
            <label>
              חיפוש
              <input value={search} placeholder="אימייל, שם או שם עסק" onChange={(event) => setSearch(event.target.value)} />
            </label>
            <div className="list admin-scroll tall">
              {filteredUsers.map((user) => (
                <div key={user.id} className="list-item fit">
                  <div>
                    <strong>
                      #{user.id} | {user.email}
                    </strong>
                    <p>
                      תפקיד: {user.role} | מושעה: {user.isSuspended ? `כן${user.suspendedUntil ? ` עד ${formatDateTime(user.suspendedUntil)}` : ''}` : 'לא'}
                    </p>
                    {user.worker && (
                      <small>
                        עובד: {user.worker.fullName} | {user.worker.city} | דירוג {user.worker.rating} | מדד {user.worker.reliabilityScore} |{' '}
                        {user.worker.verificationLevel === 'verified' ? 'מאומת' : 'בסיסי'}
                      </small>
                    )}
                    {user.employer && (
                      <small>
                        מעסיק: {user.employer.displayName} | מאומת: {user.employer.isVerified ? 'כן' : 'לא'} | דירוג{' '}
                        {user.employer.ratingAvg ?? '—'}
                      </small>
                    )}
                    {user.suspensionReason && <small>סיבת השעיה: {user.suspensionReason}</small>}
                  </div>
                  <div className="fit-actions">
                    {user.worker && user.worker.verificationLevel !== 'verified' && (
                      <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => api.verifyWorker(user.id, 'verified'), 'העובד אומת.')}>
                        אמת עובד
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.setUserSuspension(user.id, !user.isSuspended, user.isSuspended ? undefined : 'השעיה ידנית ע"י אדמין'),
                          user.isSuspended ? 'ההשעיה בוטלה.' : 'המשתמש הושעה.',
                        )
                      }
                    >
                      {user.isSuspended ? 'בטל השעיה' : 'השעה משתמש'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      )}

      {tab === 'safety' && (
        <section className="panel employer-grid">
          <article className="card">
            <h2>דיווחי משתמשים</h2>
            {reports.length === 0 && <p className="empty">אין דיווחים.</p>}
            <div className="list admin-scroll tall">
              {reports.map((report) => (
                <div key={report.id} className="list-item">
                  <strong>
                    {report.reason} · {report.status === 'open' ? 'פתוח' : report.status === 'resolved' ? 'טופל' : 'נדחה'}
                  </strong>
                  <span>
                    מדווח/ת: {report.reporterEmail} ← על: {report.reportedEmail}
                  </span>
                  {report.details && <span>{report.details}</span>}
                  <small>{formatDateTime(report.createdAt)}</small>
                  {report.status === 'open' && (
                    <div className="fit-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => void run(() => api.resolveReport(report.id, 'resolved', true), 'הדיווח טופל והמשתמש הושעה.')}
                      >
                        השעיה וסגירה
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => void run(() => api.resolveReport(report.id, 'resolved', false), 'הדיווח סומן כמטופל.')}
                      >
                        טופל ללא השעיה
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => void run(() => api.resolveReport(report.id, 'dismissed', false), 'הדיווח נדחה.')}
                      >
                        דחייה
                      </button>
                      {report.messageId && (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() => void run(() => api.deleteMessage(report.messageId!), 'ההודעה הוסרה.')}
                        >
                          הסרת ההודעה
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <h2>התראות DLP: ניסיונות להעביר פרטי קשר</h2>
            <p className="empty">כל ניסיון הוסתר אוטומטית. בהפרה השלישית המשתמש מושעה.</p>
            {violations.length === 0 && <p className="empty">אין הפרות.</p>}
            <div className="list admin-scroll tall">
              {violations.map((violation) => (
                <div key={violation.id} className="list-item">
                  <strong>
                    {violation.email} · {sourceLabels[violation.source] ?? violation.source}
                  </strong>
                  <span className="dlp-text">{violation.originalText}</span>
                  <small>{formatDateTime(violation.createdAt)}</small>
                </div>
              ))}
            </div>
          </article>
        </section>
      )}

      {tab === 'finance' && (
        <section className="panel employer-grid">
          <article className="card full-row">
            <h2>מנויי מעסיקים</h2>
            <p className="empty">
              חיוב אוטומטי עדיין לא מחובר. מעסיק שבחר מסלול בסוף הניסיון נמצא בסטטוס "ממתין לתשלום" עד שמאשרים כאן.
            </p>
            <div className="table-scroll">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>עסק</th>
                    <th>סטטוס</th>
                    <th>סוף ניסיון</th>
                    <th>מסלול</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {employers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        {user.employer!.displayName}
                        <br />
                        <small>{user.email}</small>
                      </td>
                      <td>{subscriptionLabels[user.employer!.subscriptionStatus]}</td>
                      <td>{formatDate(user.employer!.trialEndsAt)}</td>
                      <td>{planName(user.employer!.activePlanId)}</td>
                      <td>
                        <div className="fit-actions">
                          {user.employer!.subscriptionStatus !== 'active' && (
                            <button type="button" className="primary" disabled={busy} onClick={() => void run(() => api.setSubscription(user.id, 'active'), 'המנוי הופעל.')}>
                              אישור תשלום
                            </button>
                          )}
                          <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => api.setSubscription(user.id, 'trial', 30), 'הניסיון הוארך ב-30 יום.')}>
                            הארכת ניסיון
                          </button>
                          {user.employer!.subscriptionStatus === 'active' && (
                            <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => api.setSubscription(user.id, 'expired'), 'המנוי הופסק.')}>
                              הפסקה
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="card full-row">
            <h2>בקשות קידום ממומן</h2>
            {sponsorships.length === 0 && <p className="empty">אין בקשות.</p>}
            <div className="list">
              {sponsorships.map((request) => (
                <div key={request.id} className="list-item fit">
                  <div>
                    <strong>{request.jobTitle ? `משרה: ${request.jobTitle}` : 'פרופיל עובד/ת'}</strong>
                    <p>
                      {request.requesterEmail} · {request.days} ימים · {formatDate(request.createdAt)} ·{' '}
                      {request.status === 'pending' ? 'ממתין' : request.status === 'approved' ? 'אושר' : 'נדחה'}
                    </p>
                  </div>
                  {request.status === 'pending' && (
                    <div className="fit-actions">
                      <button type="button" className="primary" disabled={busy} onClick={() => void run(() => api.decideSponsorship(request.id, true), 'הקידום אושר.')}>
                        אישור
                      </button>
                      <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => api.decideSponsorship(request.id, false), 'הבקשה נדחתה.')}>
                        דחייה
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </article>
        </section>
      )}

      {tab === 'content' && (
        <section className="panel employer-grid">
          <article className="card full-row">
            <h2>תחומי עיסוק ודרישות רישוי</h2>
            <div className="list">
              {categories.map((category) => (
                <div key={category.id} className="list-item fit">
                  <div>
                    <strong>{category.name}</strong>
                    <p>
                      {category.requiredLicense ? `רישיון חובה: ${category.requiredLicense}` : 'ללא רישיון חובה'} ·{' '}
                      {category.isActive ? 'פעיל' : 'מושבת'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.saveCategory({ ...category, isActive: !category.isActive })
                        onCategoriesChanged()
                      }, 'הקטגוריה עודכנה.')
                    }
                  >
                    {category.isActive ? 'השבתה' : 'הפעלה'}
                  </button>
                </div>
              ))}
            </div>
            <h3>הוספת תחום</h3>
            <div className="form-grid">
              <label>
                שם התחום
                <input value={newCategory.name} onChange={(event) => setNewCategory({ ...newCategory, name: event.target.value })} />
              </label>
              <label>
                רישיון / תעודה חובה (לא חובה)
                <input
                  value={newCategory.requiredLicense}
                  onChange={(event) => setNewCategory({ ...newCategory, requiredLicense: event.target.value })}
                />
              </label>
            </div>
            <button
              type="button"
              className="primary"
              disabled={busy || newCategory.name.trim().length < 2}
              onClick={() =>
                void run(async () => {
                  await api.saveCategory({ name: newCategory.name, requiredLicense: newCategory.requiredLicense || null, isActive: true })
                  setNewCategory({ name: '', requiredLicense: '' })
                  onCategoriesChanged()
                }, 'התחום נוסף.')
              }
            >
              הוספה
            </button>
          </article>
        </section>
      )}
    </section>
  )
}
