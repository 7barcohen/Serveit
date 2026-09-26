import { formatDate, formatRating, LOW_RELIABILITY, stageLabels, subscriptionLabels } from '../lib/labels'
import { useNow } from '../lib/useNow'
import type { Application, EmployerProfile, ManagedJob } from '../types'

type Props = {
  profile: EmployerProfile
  hasAccess: boolean
  jobs: ManagedJob[]
  applications: Application[]
  onOpenChat: (applicationId: number) => void
  onOpenCandidates: () => void
  onOpenCompany: () => void
  onOpenJobs: () => void
}

const activeStages = new Set(['matched', 'offered', 'hired', 'waitlisted'])

// Employer home (spec §6.3): everyone who matched with the business, as cards
// sorted by reliability score, highest first.
export function EmployerHome({ profile, hasAccess, jobs, applications, onOpenChat, onOpenCandidates, onOpenCompany, onOpenJobs }: Props) {
  const now = useNow(60000)
  const matches = applications
    .filter((item) => activeStages.has(item.stage))
    .sort((a, b) => b.worker.reliabilityScore - a.worker.reliabilityScore)
  const openJobs = jobs.filter((job) => job.status === 'open').length
  const pendingOffers = applications.filter((item) => item.stage === 'offered').length
  const upcoming = applications.filter((item) => item.stage === 'hired').length
  const interested = applications.filter((item) => item.stage === 'liked').length
  const trialDaysLeft = Math.ceil((new Date(profile.trialEndsAt).getTime() - now) / 86400000)

  return (
    <section className="panel employer-grid">
      <article className="card full-row">
        <div className="pulse-stats">
          <span>{openJobs} משרות פתוחות</span>
          <span>{matches.length} התאמות פעילות</span>
          <span>{pendingOffers} הצעות ממתינות</span>
          <span>{upcoming} שיבוצים קרובים</span>
          <span>{interested} מועמדים שהתעניינו</span>
          <span>{formatRating(profile.ratingAvg, profile.ratingCount)}</span>
        </div>
        {!profile.isVerified && (
          <p className="status-box">
            {profile.verificationRequestedAt ? 'אימות העסק ממתין לאישור.' : 'יש להשלים אימות עסק כדי לפרסם משרות.'}{' '}
            <button type="button" className="link-like" onClick={onOpenCompany}>
              לפרופיל החברה
            </button>
          </p>
        )}
        {profile.subscriptionStatus === 'trial' && trialDaysLeft > 0 && (
          <p className="empty">
            {subscriptionLabels.trial}: עוד {trialDaysLeft} ימים (עד {formatDate(profile.trialEndsAt)}).
          </p>
        )}
        {!hasAccess && (
          <p className="error-text">
            {profile.subscriptionStatus === 'pending_payment'
              ? 'המסלול ממתין לאישור תשלום. בינתיים אי אפשר לפרסם או לגייס.'
              : 'תקופת הניסיון הסתיימה. יש לבחור מסלול בפרופיל החברה.'}
          </p>
        )}
        {profile.ratingWarningAt && (
          <p className="error-text">
            הדירוג הממוצע שלך ירד מתחת ל-3.5. אם לא ישתפר בתוך 7 ימים מההתראה, חשיפת המשרות שלך תופחת.
          </p>
        )}
      </article>

      <article className="card full-row">
        <div className="calendar-head">
          <h2>עובדים שעשו איתך Match</h2>
          <div className="fit-actions">
            <button type="button" className="primary" onClick={onOpenCandidates}>
              למועמדים חדשים
            </button>
            <button type="button" className="ghost" onClick={onOpenJobs}>
              למשרות שלי
            </button>
          </div>
        </div>
        {matches.length === 0 ? (
          <p className="empty">עוד אין התאמות. החליקו על מועמדים למשרות שלכם, וכשגם הם יסמנו עניין ייפתח צ׳אט.</p>
        ) : (
          <div className="match-grid">
            {matches.map((item) => (
              <div key={item.id} className={`list-item match-card ${item.worker.reliabilityScore < LOW_RELIABILITY ? 'low' : ''}`}>
                <strong>{item.worker.firstName}</strong>
                <span className="score-line">מדד אמינות {item.worker.reliabilityScore}</span>
                <span>{item.worker.rating ? `★ ${item.worker.rating.toFixed(1)}` : 'חדש/ה – עדיין ללא דירוג'}</span>
                <span>{item.job.title}</span>
                <small>
                  {stageLabels[item.stage]}
                  {item.stage === 'waitlisted' && item.waitlistPosition ? ` · מקום ${item.waitlistPosition}` : ''}
                </small>
                <button type="button" className="primary" onClick={() => onOpenChat(item.id)}>
                  {item.stage === 'matched' ? 'צ׳אט והצעת עבודה' : 'לצ׳אט'}
                </button>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  )
}
