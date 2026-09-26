import { useMemo, useRef, useState } from 'react'
import { api } from '../api'
import {
  employmentTypeLabels,
  formatDate,
  formatJobPay,
  formatRating,
  regionLabels,
  shiftLabels,
  workloadLabels,
} from '../lib/labels'
import { evaluateJob, rankJobs } from '../lib/matching'
import { errorMessage } from '../lib/useNow'
import type { City, Job, PublicEmployerProfile, WorkerProfile } from '../types'

type Props = {
  jobs: Job[]
  profile: WorkerProfile | undefined
  cities: City[]
  loading: boolean
  onSwiped: () => void
  onOpenPreferences: () => void
  onOpenProfile: () => void
}

// Worker job feed (spec §2.1): swipe right = interest, left = dismiss. Jobs are
// ranked by fit against the worker's saved preferences, with flexible ranges.
export function JobFeed({ jobs, profile, cities, loading, onSwiped, onOpenPreferences, onOpenProfile }: Props) {
  const [cardsIndex, setCardsIndex] = useState(0)
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [swipeExit, setSwipeExit] = useState<'left' | 'right' | null>(null)
  const [swipeHistory, setSwipeHistory] = useState<number[]>([])
  const [swipedIds, setSwipedIds] = useState<number[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [company, setCompany] = useState<PublicEmployerProfile | null>(null)
  const dragStartXRef = useRef<number | null>(null)

  const citiesByName = useMemo(() => new Map(cities.map((city) => [city.name, city])), [cities])

  const rankedJobs = useMemo(() => {
    const entries = jobs
      .filter((job) => !swipedIds.includes(job.id))
      .map((job) => ({ job, fit: evaluateJob(job, profile, citiesByName) }))
      .filter((entry): entry is { job: Job; fit: NonNullable<typeof entry.fit> } => entry.fit !== null)
    return rankJobs(entries)
  }, [jobs, swipedIds, profile, citiesByName])

  const effectiveCardIndex = cardsIndex > rankedJobs.length ? rankedJobs.length : cardsIndex
  const visible = rankedJobs[effectiveCardIndex]
  const visibleCard = visible?.job
  const nextCard = rankedJobs[effectiveCardIndex + 1]
  const swipeMood = swipeExit ?? (dragX > 25 ? 'right' : dragX < -25 ? 'left' : 'idle')

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (!visibleCard || swipeExit) {
      return
    }

    const activeJobId = visibleCard.id
    setSwipeExit(direction)
    setDragX(direction === 'right' ? 220 : -220)
    setSwipeHistory((previous) => [...previous, activeJobId])
    setNotice('')
    setError('')

    window.setTimeout(() => {
      setSwipedIds((previous) => [...previous, activeJobId])
      setDragX(0)
      setSwipeExit(null)
    }, 180)

    try {
      const stage = await api.swipeJob(activeJobId, direction)
      if (direction === 'right') {
        setNotice(
          stage === 'matched' || stage === 'waitlisted'
            ? `יש Match עם ${visibleCard.employerName}! הצ׳אט נפתח.`
            : 'סימנת עניין. אם גם המעסיק יסמן אותך, ייפתח צ׳אט.',
        )
        onSwiped()
      }
    } catch (caught) {
      setError(errorMessage(caught, 'שמירת ההחלקה נכשלה.'))
      setSwipedIds((previous) => previous.filter((id) => id !== activeJobId))
    }
  }

  const startDrag = (x: number) => {
    if (swipeExit) {
      return
    }
    dragStartXRef.current = x
    setIsDragging(true)
  }

  const moveDrag = (x: number) => {
    if (!isDragging || dragStartXRef.current === null || swipeExit) {
      return
    }
    // Page is right-to-left: dragging right is still "interested".
    setDragX(x - dragStartXRef.current)
  }

  const endDrag = async () => {
    if (!isDragging) {
      return
    }

    setIsDragging(false)
    const finalX = dragX

    if (finalX > 90) {
      await handleSwipe('right')
      return
    }

    if (finalX < -90) {
      await handleSwipe('left')
      return
    }

    setDragX(0)
  }

  // Bring back the last card; swiping it again updates the saved choice.
  const handleRewind = () => {
    if (swipeHistory.length === 0 || swipeExit) {
      return
    }
    const previousJobId = swipeHistory[swipeHistory.length - 1]
    setSwipedIds((previous) => previous.filter((id) => id !== previousJobId))
    setSwipeHistory((previous) => previous.slice(0, -1))
    setCardsIndex(0)
    setDragX(0)
  }

  const openCompany = async (employerId: number) => {
    try {
      setCompany(await api.getEmployerPublicProfile(employerId))
    } catch (caught) {
      setError(errorMessage(caught, 'טעינת פרופיל החברה נכשלה.'))
    }
  }

  if (profile && !profile.isAvailable) {
    return (
      <article className="card">
        <h2>הפרופיל שלך מושהה</h2>
        <p className="empty">סימנת שאת/ה לא פעיל/ה כרגע בחיפוש עבודה, ולכן לא מוצגות משרות.</p>
        <button type="button" className="primary" onClick={onOpenProfile}>
          להפעלה מחדש
        </button>
      </article>
    )
  }

  return (
    <section className="panel worker-grid jobs-layout">
      <article className="card swipe-card">
        <h2>החלקה על משרות</h2>
        <p className="empty">גררו את הכרטיס ימינה לעניין, שמאלה לדילוג.</p>
        <div className="swipe-actions compact">
          <button type="button" className="ghost" onClick={handleRewind} disabled={swipeHistory.length === 0}>
            החזר כרטיס קודם
          </button>
          <button type="button" className="ghost" onClick={() => void handleSwipe('left')} disabled={!visibleCard || !!swipeExit}>
            דלג
          </button>
          <button type="button" className="primary" onClick={() => void handleSwipe('right')} disabled={!visibleCard || !!swipeExit}>
            אני בעניין
          </button>
        </div>
        {notice && <p className="status-box">{notice}</p>}
        {error && <p className="error-text">{error}</p>}
        {loading ? (
          <p className="empty">טוען משרות...</p>
        ) : visibleCard && visible ? (
          <div
            className={`swipe-stage ${swipeMood}`}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest('button')) return
              startDrag(event.clientX)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => moveDrag(event.clientX)}
            onPointerUp={() => void endDrag()}
            onPointerCancel={() => void endDrag()}
          >
            {nextCard && <div className="swipe-next-shadow" aria-hidden="true" />}
            <div
              className={`swipe-card-body ${swipeExit ? `exit-${swipeExit}` : ''}`}
              style={{
                transform: `translateX(${dragX}px) rotate(${dragX * 0.045}deg)`,
                transition: isDragging ? 'none' : 'transform 220ms ease',
              }}
            >
              <div className="job-card-head">
                {visibleCard.employerLogoUrl ? (
                  <img className="company-logo" src={visibleCard.employerLogoUrl} alt="" />
                ) : (
                  <span className="company-logo placeholder" aria-hidden="true">
                    {visibleCard.employerName.slice(0, 1)}
                  </span>
                )}
                <div>
                  <button type="button" className="link-like" onClick={() => void openCompany(visibleCard.employerId)}>
                    {visibleCard.employerName}
                  </button>
                  <small>
                    {visibleCard.verifiedEmployer ? '✓ עסק מאומת · ' : ''}
                    {formatRating(visibleCard.employerRatingAvg, visibleCard.employerRatingCount)}
                  </small>
                </div>
              </div>
              <div className="pill-row">
                {visibleCard.isSponsored && <span className="pill sponsored">ממומן</span>}
                {visible.fit.level === 'exact' && <span className="pill fit-exact">מתאים בדיוק</span>}
                {visible.fit.level === 'near' && <span className="pill fit-near">קרוב להעדפות</span>}
                <span className="pill">{employmentTypeLabels[visibleCard.employmentType]}</span>
                {visibleCard.workload && <span className="pill">{workloadLabels[visibleCard.workload]}</span>}
                <span className="pill">{visibleCard.category}</span>
                <span className="pill">{shiftLabels[visibleCard.shift]}</span>
                <span className="pill">
                  {visibleCard.city}
                  {visibleCard.region ? ` · ${regionLabels[visibleCard.region]}` : ''}
                  {visible.fit.distanceKm !== null ? ` · ${Math.round(visible.fit.distanceKm)} ק״מ` : ''}
                </span>
              </div>
              <h3>{visibleCard.title}</h3>
              <p>{visibleCard.description}</p>
              {visibleCard.employerDescription && <p className="empty">על העסק: {visibleCard.employerDescription}</p>}
              <ul>
                <li>
                  {visibleCard.employmentType === 'permanent' ? 'תחילת עבודה' : 'תאריך'}: {formatDate(visibleCard.date)}
                </li>
                <li>שכר: {formatJobPay(visibleCard)}</li>
                {visibleCard.transportOffered && (
                  <li>הסעה: {visibleCard.transportFrom ? `מ${visibleCard.transportFrom}` : 'כלולה'}</li>
                )}
                {visibleCard.requiredLicense && <li>נדרש: {visibleCard.requiredLicense}</li>}
                {visibleCard.status === 'filled' && <li>המשמרת מלאה: Match יכניס אותך לרשימת ההמתנה</li>}
              </ul>
              {visible.fit.notes.length > 0 && <p className="fit-notes">{visible.fit.notes.join(' · ')}</p>}
              <div className="swipe-indicators">
                <span className={`swipe-badge no ${dragX < -24 ? 'show' : ''}`}>לא מתאים</span>
                <span className={`swipe-badge yes ${dragX > 24 ? 'show' : ''}`}>בול בשבילי</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty">
              {jobs.length === 0 ? 'אין כרגע משרות חדשות. נעדכן בהתראה כשתתפרסם משרה שמתאימה לך.' : 'עברת על כל המשרות שמתאימות להעדפות שלך.'}
            </p>
            <button type="button" className="ghost" onClick={onOpenPreferences}>
              עדכון העדפות
            </button>
          </div>
        )}
      </article>

      <aside className="card">
        {company ? (
          <>
            <div className="calendar-head">
              <h2>{company.displayName}</h2>
              <button type="button" className="ghost" onClick={() => setCompany(null)}>
                סגירה
              </button>
            </div>
            {company.logoUrl && <img className="company-logo large" src={company.logoUrl} alt="" />}
            <p>{company.isVerified ? '✓ עסק מאומת' : 'עסק לא מאומת'}</p>
            <p>{formatRating(company.ratingAvg, company.ratingCount)}</p>
            <p>{company.description || 'אין תיאור.'}</p>
            {company.regions.length > 0 && <p>אזורי פעילות: {company.regions.map((region) => regionLabels[region]).join(', ')}</p>}
            <p>משרות פתוחות: {company.openJobs}</p>
            <div className="photo-grid">
              {company.photoUrls.map((url) => (
                <img key={url} src={url} alt="סביבת העבודה" />
              ))}
            </div>
          </>
        ) : (
          <>
            <h2>איך מתאימים לך משרות?</h2>
            <p className="empty">
              {profile?.preferences.length
                ? `הפיד מדורג לפי ${profile.preferences.length} ההעדפות השמורות שלך. משרות "קרובות" מעט חורגות מהטווח, מהשכר או מהתחום, וכדאי לדבר עליהן בצ׳אט.`
                : 'עוד לא שמרת העדפות, אז מוצגות כל המשרות. הוספת העדפות תסדר את הפיד לפי מיקום, שכר, תחום וזמינות.'}
            </p>
            <p className="empty">{rankedJobs.length} משרות בפיד.</p>
            <button type="button" className="ghost" onClick={onOpenPreferences}>
              להעדפות שלי
            </button>
          </>
        )}
      </aside>
    </section>
  )
}
