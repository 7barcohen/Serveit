import { useEffect, useMemo, useRef, useState } from 'react'
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
import { evaluateJob, rankJobs, type JobFit } from '../lib/matching'
import { errorMessage } from '../lib/useNow'
import type { City, Job, PublicEmployerProfile, WorkerProfile } from '../types'

type Props = {
  userId: number
  jobs: Job[]
  profile: WorkerProfile | undefined
  cities: City[]
  loading: boolean
  onSwiped: () => void
  onOpenPreferences: () => void
  onOpenProfile: () => void
}

type FeedFilter = 'all' | 'best' | 'near' | 'transport' | 'saved'

const filters: Array<{ id: FeedFilter; label: string }> = [
  { id: 'all', label: 'הכול' },
  { id: 'best', label: 'התאמה גבוהה' },
  { id: 'near', label: 'קרוב אליי' },
  { id: 'transport', label: 'כולל הסעה' },
  { id: 'saved', label: 'שמורות' },
]

const savedJobsKey = (userId: number) => `shiftted:saved-jobs:${userId}`
const savedJobDataKey = (userId: number) => `shiftted:saved-job-data:${userId}`

const readSavedJobs = (userId: number) => {
  try {
    const stored = window.localStorage.getItem(savedJobsKey(userId))
    const parsed: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : []
  } catch {
    return []
  }
}

const readSavedJobSnapshots = (userId: number): Job[] => {
  try {
    const stored = window.localStorage.getItem(savedJobDataKey(userId))
    const parsed: unknown = stored ? JSON.parse(stored) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is Job => {
      if (!value || typeof value !== 'object') return false
      const job = value as Partial<Job>
      return typeof job.id === 'number' && typeof job.title === 'string'
        && typeof job.category === 'string' && typeof job.city === 'string'
        && typeof job.date === 'string' && typeof job.shift === 'string'
        && typeof job.employerId === 'number' && typeof job.employerName === 'string'
    })
  } catch {
    return []
  }
}

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const BookmarkIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
    <path d="M6.5 4.5h11v16l-5.5-3.8-5.5 3.8v-16Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m5 12 4.2 4.2L19 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const LocationIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
  </svg>
)

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

// Worker job feed: matching and ranking remain unchanged; presentation filters
// only narrow the already-loaded feed. Saved IDs and display snapshots stay local to this account/browser.
export function JobFeed({ userId, jobs, profile, cities, loading, onSwiped, onOpenPreferences, onOpenProfile }: Props) {
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [swipeExit, setSwipeExit] = useState<'left' | 'right' | null>(null)
  const [swipeHistory, setSwipeHistory] = useState<number[]>([])
  const [swipedIds, setSwipedIds] = useState<number[]>([])
  const [pendingSwipeIds, setPendingSwipeIds] = useState<number[]>([])
  const [activeFilter, setActiveFilter] = useState<FeedFilter>('all')
  const [savedJobIds, setSavedJobIds] = useState<number[]>(() => readSavedJobs(userId))
  const [savedJobSnapshots, setSavedJobSnapshots] = useState<Job[]>(() => readSavedJobSnapshots(userId))
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [company, setCompany] = useState<PublicEmployerProfile | null>(null)
  const companyPanelRef = useRef<HTMLElement | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const dragLockedRef = useRef(false)
  const swipeTimersRef = useRef(new Map<number, number>())
  const activeSwipeJobIdRef = useRef<number | null>(null)

  const citiesByName = useMemo(() => new Map(cities.map((city) => [city.name, city])), [cities])

  const rankedJobs = useMemo(() => {
    const entries = jobs
      .filter((job) => !swipedIds.includes(job.id))
      .map((job) => ({ job, fit: evaluateJob(job, profile, citiesByName) }))
      .filter((entry): entry is { job: Job; fit: NonNullable<typeof entry.fit> } => entry.fit !== null)
    return rankJobs(entries)
  }, [jobs, swipedIds, profile, citiesByName])

  const savedJobs = useMemo(() => {
    const currentSaved = jobs.filter((job) => savedJobIds.includes(job.id))
    const currentIds = new Set(currentSaved.map((job) => job.id))
    const combined = [...currentSaved, ...savedJobSnapshots.filter((job) => savedJobIds.includes(job.id) && !currentIds.has(job.id))]
    const entries = combined.map((job) => ({
      job,
      fit: evaluateJob(job, profile, citiesByName) ?? {
        level: 'near' as const,
        distanceKm: null,
        notes: ['העדפות החיפוש השתנו מאז שמירת המשרה'],
      } satisfies JobFit,
    }))
    return rankJobs(entries)
  }, [jobs, savedJobIds, savedJobSnapshots, profile, citiesByName])

  const filteredJobs = useMemo(() => {
    switch (activeFilter) {
      case 'best':
        return rankedJobs.filter(({ fit }) => fit.level === 'exact' || fit.level === 'open')
      case 'near':
        return rankedJobs.filter(({ job, fit }) =>
          fit.distanceKm !== null ? fit.distanceKm <= 15 : job.city === profile?.city,
        )
      case 'transport':
        return rankedJobs.filter(({ job }) => job.transportOffered)
      case 'saved':
        return savedJobs
      default:
        return rankedJobs
    }
  }, [activeFilter, rankedJobs, savedJobs, profile?.city])

  const visible = filteredJobs[0]
  const visibleCard = visible?.job
  const nextCard = filteredJobs[1]
  const swipeMood = swipeExit ?? (dragX > 25 ? 'right' : dragX < -25 ? 'left' : 'idle')
  const isExpanded = visibleCard ? expandedJobId === visibleCard.id : false

  useEffect(() => {
    try {
      window.localStorage.setItem(savedJobsKey(userId), JSON.stringify(savedJobIds))
    } catch {
      // Private browsing or storage restrictions: saving remains available for this visit.
    }
  }, [savedJobIds, userId])

  useEffect(() => () => {
    swipeTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    swipeTimersRef.current.clear()
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(savedJobDataKey(userId), JSON.stringify(savedJobSnapshots))
    } catch {
      // Private browsing or storage restrictions: retain current in-memory snapshots only.
    }
  }, [savedJobSnapshots, userId])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!company || !window.matchMedia('(max-width: 900px)').matches) return
    const frame = window.requestAnimationFrame(() => {
      companyPanelRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [company])

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (!visibleCard || swipeExit) return

    const activeJobId = visibleCard.id
    activeSwipeJobIdRef.current = activeJobId
    setPendingSwipeIds((previous) => previous.includes(activeJobId) ? previous : [...previous, activeJobId])
    setSwipeExit(direction)
    setDragX(direction === 'right' ? 220 : -220)
    setSwipeHistory((previous) => [...previous, activeJobId])
    setNotice('')
    setError('')

    const existingTimer = swipeTimersRef.current.get(activeJobId)
    if (existingTimer !== undefined) window.clearTimeout(existingTimer)
    const timer = window.setTimeout(() => {
      setSwipedIds((previous) => previous.includes(activeJobId) ? previous : [...previous, activeJobId])
      swipeTimersRef.current.delete(activeJobId)
      if (activeSwipeJobIdRef.current === activeJobId) {
        setDragX(0)
        setSwipeExit(null)
        activeSwipeJobIdRef.current = null
      }
    }, 180)
    swipeTimersRef.current.set(activeJobId, timer)

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
      const pendingTimer = swipeTimersRef.current.get(activeJobId)
      if (pendingTimer !== undefined) window.clearTimeout(pendingTimer)
      swipeTimersRef.current.delete(activeJobId)
      if (activeSwipeJobIdRef.current === activeJobId) {
        activeSwipeJobIdRef.current = null
        setSwipeExit(null)
        setDragX(0)
      }
      setSwipedIds((previous) => previous.filter((id) => id !== activeJobId))
      setSwipeHistory((previous) => previous.filter((id) => id !== activeJobId))
      setError(errorMessage(caught, 'שמירת ההחלקה נכשלה. אפשר לנסות שוב.'))
    } finally {
      setPendingSwipeIds((previous) => previous.filter((id) => id !== activeJobId))
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activeFilter === 'saved' || swipeExit || (event.target as HTMLElement).closest('button, a, input, select, textarea')) return
    dragStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    dragLockedRef.current = false
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start || event.pointerId !== start.pointerId || swipeExit) return
    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (!dragLockedRef.current) {
      if (Math.abs(deltaX) < 10 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return
      dragLockedRef.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setIsDragging(true)
    }
    setDragX(deltaX)
  }

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start || event.pointerId !== start.pointerId) return
    const deltaX = event.clientX - start.x
    const wasHorizontalDrag = dragLockedRef.current
    dragStartRef.current = null
    dragLockedRef.current = false
    setIsDragging(false)
    if (activeFilter !== 'saved' && wasHorizontalDrag && Math.abs(deltaX) > 90) {
      void handleSwipe(deltaX > 0 ? 'right' : 'left')
    } else {
      setDragX(0)
    }
  }

  const cancelPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId !== event.pointerId) return
    dragStartRef.current = null
    dragLockedRef.current = false
    setIsDragging(false)
    setDragX(0)
  }

  const handleRewind = () => {
    if (swipeHistory.length === 0 || swipeExit) return
    const previousJobId = swipeHistory[swipeHistory.length - 1]
    if (pendingSwipeIds.includes(previousJobId)) {
      setNotice('ממתינים לאישור שמירת הפעולה לפני שאפשר להחזיר את המשרה.')
      return
    }
    setSwipedIds((previous) => previous.filter((id) => id !== previousJobId))
    setSwipeHistory((previous) => previous.slice(0, -1))
    setDragX(0)
    setNotice('המשרה חזרה לפיד. אפשר לבחור שוב.')
    setError('')
  }

  const toggleSaved = (jobId: number) => {
    const isSaved = savedJobIds.includes(jobId)
    setSavedJobIds((previous) => isSaved ? previous.filter((id) => id !== jobId) : [...previous, jobId])
    const snapshot = jobs.find((job) => job.id === jobId) ?? savedJobSnapshots.find((job) => job.id === jobId)
    if (isSaved) setSavedJobSnapshots((previous) => previous.filter((job) => job.id !== jobId))
    else if (snapshot) setSavedJobSnapshots((previous) => previous.some((job) => job.id === jobId) ? previous : [...previous, snapshot])
    setNotice(isSaved ? 'המשרה הוסרה מהמשרות השמורות.' : 'המשרה נשמרה במכשיר הזה, גם אם תצאי מהפיד.')
    setError('')
  }

  const selectFilter = (filter: FeedFilter) => {
    setActiveFilter(filter)
    setNotice('')
    setError('')
    setExpandedJobId(null)
    setDragX(0)
  }

  const openCompany = async (employerId: number) => {
    setError('')
    try {
      setCompany(await api.getEmployerPublicProfile(employerId))
    } catch (caught) {
      setError(errorMessage(caught, 'טעינת פרופיל החברה נכשלה.'))
    }
  }

  if (profile && !profile.isAvailable) {
    return (
      <article className="card job-feed-paused">
        <span className="job-feed-eyebrow">ShiftTed · מצב זמינות</span>
        <h2>הפרופיל שלך מושהה</h2>
        <p>סימנת שאינך זמין/ה כרגע, ולכן המשרות ממתינות עד להפעלה מחדש.</p>
        <button type="button" className="job-feed-primary" onClick={onOpenProfile}>להפעלה מחדש</button>
      </article>
    )
  }

  return (
    <section className="job-feed-layout" aria-label="חיפוש משרות">
      <article className="job-feed-main">
        <header className="job-feed-intro">
          <div>
            <p className="job-feed-eyebrow">הזדמנות חדשה, בקצב שלך</p>
            <h2>משרות שמתאימות לווייב שלך</h2>
            <p className="job-feed-subtitle">{profile?.fullName ? `היי ${profile.fullName.split(' ')[0]}, ` : ''}מצאנו משרות לפי ההעדפות והזמינות שלך.</p>
          </div>
          <div className="job-feed-pulse" aria-label={`${filteredJobs.length} משרות מוצגות`}>
            <span className="job-feed-pulse-dot" aria-hidden="true" />
            <strong>{filteredJobs.length}</strong>
            <span>משרות</span>
          </div>
        </header>

        <div className="job-feed-filter-head">
          <div>
            <h3>הפיד שלך</h3>
            <p>{activeFilter === 'all' ? 'בחירות טובות, בלי לגלול לנצח.' : `מסונן לפי: ${filters.find((filter) => filter.id === activeFilter)?.label}`}</p>
          </div>
          <button type="button" className="job-feed-preferences-link" onClick={onOpenPreferences}>
            <span>העדפות</span><ArrowIcon />
          </button>
        </div>

        <div className="job-feed-filters" role="group" aria-label="סינון המשרות">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`job-feed-filter ${activeFilter === filter.id ? 'active' : ''}`}
              aria-pressed={activeFilter === filter.id}
              onClick={() => selectFilter(filter.id)}
            >
              {filter.id === 'saved' && <BookmarkIcon filled={activeFilter === 'saved'} />}
              <span>{filter.label}</span>
              {filter.id === 'saved' && savedJobIds.length > 0 && <span className="job-feed-filter-count">{savedJobIds.length}</span>}
            </button>
          ))}
        </div>

        {(notice || error) && (
          <div className={error ? 'job-feed-message error' : 'job-feed-message'} role={error ? 'alert' : 'status'} aria-live="polite">
            {error || notice}
          </div>
        )}

        {loading ? (
          <div className="job-feed-loading" role="status" aria-live="polite">
            <span className="job-feed-skeleton visual" />
            <span className="job-feed-skeleton title" />
            <span className="job-feed-skeleton line" />
            <span className="job-feed-skeleton line short" />
            <span className="job-feed-skeleton button" />
            <span>טוען משרות שמתאימות לך…</span>
          </div>
        ) : visibleCard && visible ? (
          <>
            <div className="job-feed-card-stack">
              {nextCard && <div className="job-feed-card-peek" aria-hidden="true" />}
              <article
                className={`job-feed-job-card ${swipeMood} ${isDragging ? 'dragging' : ''} ${swipeExit ? `exit-${swipeExit}` : ''}`}
                aria-label={`משרה: ${visibleCard.title} אצל ${visibleCard.employerName}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointer}
                onPointerCancel={cancelPointer}
                onKeyDown={(event) => {
                  if (activeFilter === 'saved' || event.target !== event.currentTarget) return
                  if (event.key === 'ArrowRight') { event.preventDefault(); void handleSwipe('right') }
                  if (event.key === 'ArrowLeft') { event.preventDefault(); void handleSwipe('left') }
                }}
                tabIndex={0}
              >
                <div className="job-feed-art">
                  <div className="job-feed-art-copy">
                    <span className="job-feed-match-label"><i />{visible.fit.level === 'exact' ? 'מתאים להעדפות שלך' : visible.fit.level === 'near' ? 'קרוב להעדפות שלך' : 'פתוח להזדמנויות'}</span>
                    <span className="job-feed-art-title">{visibleCard.category} · {shiftLabels[visibleCard.shift]}</span>
                    <span className="job-feed-art-subtitle">{formatDate(visibleCard.date)} · {visibleCard.city}</span>
                  </div>
                  <svg className="job-feed-art-graphic" viewBox="0 0 150 112" fill="none" aria-hidden="true">
                    <path d="M10 94c12-17 25-25 39-25s27 8 39 25m-35 0c11-15 23-22 35-22s24 7 35 22" stroke="white" strokeOpacity=".72" strokeWidth="3" strokeLinecap="round" />
                    <path d="M35 65V42m0 0-9-11m9 11 9-11m57 34V36m0 0-9-11m9 11 9-11M8 99h133" stroke="#d9f99d" strokeWidth="3" strokeLinecap="round" />
                    <circle cx="35" cy="27" r="5" fill="#a3e635" /><circle cx="101" cy="20" r="5" fill="#a3e635" />
                  </svg>
                  <button
                    type="button"
                    className={`job-feed-save ${savedJobIds.includes(visibleCard.id) ? 'saved' : ''}`}
                    aria-label={savedJobIds.includes(visibleCard.id) ? 'הסרת המשרה מהשמורות' : 'שמירת המשרה'}
                    aria-pressed={savedJobIds.includes(visibleCard.id)}
                    onClick={() => toggleSaved(visibleCard.id)}
                  >
                    <BookmarkIcon filled={savedJobIds.includes(visibleCard.id)} />
                  </button>
                  {visibleCard.isSponsored && <span className="job-feed-sponsored">ממומן</span>}
                </div>

                <div className="job-feed-card-content">
                  <div className="job-feed-card-topline">
                    <div className="job-feed-employer">
                      {visibleCard.employerLogoUrl ? (
                        <img className="job-feed-employer-mark" src={visibleCard.employerLogoUrl} alt={`לוגו ${visibleCard.employerName}`} />
                      ) : (
                        <span className="job-feed-employer-mark placeholder" aria-hidden="true">{visibleCard.employerName.slice(0, 1)}</span>
                      )}
                      <div className="job-feed-employer-meta">
                        <button type="button" className="job-feed-employer-link" onClick={() => void openCompany(visibleCard.employerId)}>{visibleCard.employerName}</button>
                        <span className="job-feed-trust">
                          {visibleCard.verifiedEmployer && <><CheckIcon /><span>עסק מאומת</span><i>·</i></>}
                          <span>{formatRating(visibleCard.employerRatingAvg, visibleCard.employerRatingCount)}</span>
                        </span>
                      </div>
                    </div>
                    <span className={`job-feed-fit ${visible.fit.level}`}>
                      <span className="job-feed-fit-dot" aria-hidden="true" />
                      {visible.fit.level === 'exact' ? 'התאמה גבוהה' : visible.fit.level === 'near' ? 'קרוב להעדפות' : 'לפי בחירתך'}
                    </span>
                  </div>

                  <h3 className="job-feed-title">{visibleCard.title}</h3>
                  <div className="job-feed-meta" aria-label="פרטי המשרה">
                    <span className="job-feed-chip"><LocationIcon /><span>{visibleCard.city}{visibleCard.region ? ` · ${regionLabels[visibleCard.region]}` : ''}</span></span>
                    <span className="job-feed-chip"><ClockIcon /><bdi dir="auto">{shiftLabels[visibleCard.shift]}</bdi></span>
                    {visible.fit.distanceKm !== null && <span className="job-feed-chip"><LocationIcon /><bdi dir="ltr">{Math.round(visible.fit.distanceKm)} ק״מ</bdi></span>}
                    {visibleCard.workload && <span className="job-feed-chip">{workloadLabels[visibleCard.workload]}</span>}
                    <span className="job-feed-chip">{employmentTypeLabels[visibleCard.employmentType]}</span>
                  </div>

                  <div className="job-feed-pay-panel">
                    <div>
                      <div className="job-feed-pay-line"><strong dir="auto">{formatJobPay(visibleCard)}</strong><span>{visibleCard.payType === 'hourly' ? 'תשלום לשעה' : 'תשלום חודשי'}</span></div>
                      <span className="job-feed-pay-note">תנאי השכר מוצגים מראש</span>
                    </div>
                    <span className="job-feed-pay-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18m5-14H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></span>
                  </div>

                  <button
                    type="button"
                    className="job-feed-details-toggle"
                    aria-expanded={isExpanded}
                    aria-controls={`job-details-${visibleCard.id}`}
                    onClick={() => setExpandedJobId(isExpanded ? null : visibleCard.id)}
                  >
                    <span>{isExpanded ? 'פחות פרטים' : 'קצת יותר פרטים'}</span>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <div className={`job-feed-details ${isExpanded ? 'open' : ''}`} id={`job-details-${visibleCard.id}`}>
                    <p>{visibleCard.description}</p>
                    {visibleCard.employerDescription && <p><strong>על העסק:</strong> {visibleCard.employerDescription}</p>}
                    <ul>
                      <li><strong>{visibleCard.employmentType === 'permanent' ? 'תחילת עבודה' : 'תאריך'}:</strong> {formatDate(visibleCard.date)}</li>
                      {visibleCard.transportOffered && <li><strong>הסעה:</strong> {visibleCard.transportFrom ? `מ${visibleCard.transportFrom}` : 'כלולה'}</li>}
                      {visibleCard.requiredLicense && <li><strong>נדרש:</strong> {visibleCard.requiredLicense}</li>}
                      <li><strong>עובדים דרושים:</strong> <bdi dir="ltr">{visibleCard.hiredCount}/{visibleCard.requiredWorkers}</bdi></li>
                      {visibleCard.status === 'filled' && <li>המשמרת מלאה — התאמה תציב אותך ברשימת ההמתנה.</li>}
                    </ul>
                    {visible.fit.notes.length > 0 && <p className="job-feed-fit-notes">{visible.fit.notes.join(' · ')}</p>}
                  </div>
                  <div className="job-feed-swipe-hint">
                    {activeFilter === 'saved'
                      ? <span>משרה שמורה — ניתן לפתוח פרטים או להסיר מהשמורות</span>
                      : <><span aria-hidden="true">↔</span><span>אפשר לגרור ימינה או שמאלה — או לבחור פעולה</span></>}
                  </div>
                </div>
              </article>
            </div>

            <div className={`job-feed-actions ${activeFilter === 'saved' ? 'saved-view' : ''}`} aria-label="פעולות על המשרה">
              {activeFilter === 'saved' ? (
                <>
                  <button type="button" className="job-feed-action secondary" onClick={() => selectFilter('all')}>חזרה לפיד</button>
                  <button type="button" className="job-feed-action primary" onClick={() => toggleSaved(visibleCard.id)}>
                    <BookmarkIcon filled />
                    <span>הסרת שמירה</span>
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="job-feed-action secondary" aria-label="דילוג על המשרה" onClick={() => void handleSwipe('left')} disabled={!!swipeExit}>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                  </button>
                  <button type="button" className="job-feed-action primary" onClick={() => void handleSwipe('right')} disabled={!!swipeExit}>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.8 8.8c0 5.2-8.8 11-8.8 11s-8.8-5.8-8.8-11a4.8 4.8 0 0 1 8.8-2.7 4.8 4.8 0 0 1 8.8 2.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                    <span>אני בעניין</span>
                  </button>
                  <button type="button" className={`job-feed-action secondary ${savedJobIds.includes(visibleCard.id) ? 'saved' : ''}`} aria-label={savedJobIds.includes(visibleCard.id) ? 'הסרת המשרה מהשמורות' : 'שמירת המשרה להמשך'} aria-pressed={savedJobIds.includes(visibleCard.id)} onClick={() => toggleSaved(visibleCard.id)}>
                    <BookmarkIcon filled={savedJobIds.includes(visibleCard.id)} />
                  </button>
                </>
              )}
            </div>

            {activeFilter !== 'saved' && <div className="job-feed-undo-row">
              <button type="button" className="job-feed-undo" onClick={handleRewind} disabled={swipeHistory.length === 0 || !!swipeExit || pendingSwipeIds.includes(swipeHistory[swipeHistory.length - 1])}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>החזרת המשרה האחרונה</span>
              </button>
              <span className="job-feed-progress-label">{filteredJobs.length} בפיד</span>
            </div>}
          </>
        ) : (
          <div className="job-feed-empty">
            <span className="job-feed-empty-mark" aria-hidden="true"><BookmarkIcon /></span>
            <h3>{loading ? 'טוען משרות…' : activeFilter === 'saved' ? 'עוד לא שמרת משרות' : activeFilter === 'all' && jobs.length === 0 ? 'אין כרגע משרות חדשות' : 'אין משרות בסינון הזה'}</h3>
            <p>{activeFilter === 'saved' ? 'שמרי משרה שמעניינת אותך ונחזור אליה כאן.' : 'נסי מסנן אחר או עדכני את ההעדפות כדי למצוא עוד הזדמנויות.'}</p>
            {activeFilter !== 'all' && <button type="button" className="job-feed-secondary" onClick={() => selectFilter('all')}>הצגת כל המשרות</button>}
            <button type="button" className="job-feed-primary" onClick={onOpenPreferences}>עדכון העדפות</button>
          </div>
        )}
      </article>

      <aside className="job-feed-side card" aria-label="מידע נוסף על ההתאמה" ref={companyPanelRef}>
        {company ? (
          <>
            <div className="job-feed-side-head">
              <div><p className="job-feed-eyebrow">העסק שמאחורי המשרה</p><h3>{company.displayName}</h3></div>
              <button type="button" className="job-feed-close" onClick={() => setCompany(null)}>סגירה</button>
            </div>
            {company.logoUrl && <img className="job-feed-company-logo" src={company.logoUrl} alt={`לוגו ${company.displayName}`} />}
            <p className="job-feed-company-status">{company.isVerified ? 'עסק מאומת' : 'עסק לא מאומת'} · {formatRating(company.ratingAvg, company.ratingCount)}</p>
            <p>{company.description || 'אין תיאור נוסף לעסק.'}</p>
            {company.regions.length > 0 && <p>אזורי פעילות: {company.regions.map((region) => regionLabels[region]).join(', ')}</p>}
            <p>משרות פתוחות: <bdi dir="ltr">{company.openJobs}</bdi></p>
            {company.photoUrls.length > 0 && <div className="job-feed-company-photos">{company.photoUrls.map((url) => <img key={url} src={url} alt={`סביבת העבודה ב${company.displayName}`} />)}</div>}
          </>
        ) : (
          <>
            <span className="job-feed-side-icon" aria-hidden="true"><CheckIcon /></span>
            <p className="job-feed-eyebrow">איך זה עובד</p>
            <h3>בחירה שמתאימה לך</h3>
            <p>{profile?.preferences.length
              ? `הפיד מדורג לפי ${profile.preferences.length} ההעדפות שלך. משרות שמתאימות בדיוק מופיעות קודם; גם משרות קרובות מוצגות עם הסבר.`
              : 'עוד לא שמרת העדפות, ולכן הפיד פתוח למשרות רבות. הוספת העדפות תעזור למיין לפי מיקום, שכר, תחום וזמינות.'}</p>
            <div className="job-feed-side-stat"><strong>{rankedJobs.length}</strong><span>משרות מתאימות כרגע</span></div>
            <button type="button" className="job-feed-secondary" onClick={onOpenPreferences}>ניהול ההעדפות שלי <ArrowIcon /></button>
          </>
        )}
      </aside>
    </section>
  )
}
