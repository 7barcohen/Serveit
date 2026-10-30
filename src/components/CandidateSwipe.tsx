import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { formatRating, LOW_RELIABILITY } from '../lib/labels'
import { errorMessage } from '../lib/useNow'
import type { Candidate, ManagedJob } from '../types'

type Props = {
  jobs: ManagedJob[]
  selectedJobId: number | null
  onSelectJob: (jobId: number) => void
  onMatched: () => void
}

// Employer candidate feed (spec §2.2): right = approve into potential matches,
// left = reject for this job. A match happens only when both sides swiped right.
export function CandidateSwipe({ jobs, selectedJobId, onSelectJob, onMatched }: Props) {
  const openJobs = jobs.filter((job) => job.status !== 'closed')
  const jobId = selectedJobId && openJobs.some((job) => job.id === selectedJobId) ? selectedJobId : openJobs[0]?.id ?? null
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [swipeExit, setSwipeExit] = useState<'left' | 'right' | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const dragLockedRef = useRef(false)

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (jobId === null) return
    let alive = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const loaded = await api.getCandidates(jobId)
        if (alive) setCandidates(loaded)
      } catch (caught) {
        if (alive) setError(errorMessage(caught, 'טעינת המועמדים נכשלה.'))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [jobId, reloadKey])

  if (openJobs.length === 0) {
    return (
      <article className="card">
        <h2>מועמדים</h2>
        <p className="empty">כדי לראות מועמדים צריך משרה פעילה. אפשר לפרסם אחת בלשונית "המשרות שלי".</p>
      </article>
    )
  }

  const candidate = candidates[0]
  const selectedJob = openJobs.find((job) => job.id === jobId)
  const swipeMood = swipeExit ?? (dragX > 25 ? 'right' : dragX < -25 ? 'left' : 'idle')

  const swipe = async (direction: 'left' | 'right') => {
    if (!candidate || jobId === null || swipeExit) return
    setSwipeExit(direction)
    setDragX(direction === 'right' ? 220 : -220)
    setNotice('')
    setError('')
    try {
      const stage = await api.swipeCandidate(jobId, candidate.workerId, direction)
      if (direction === 'right') {
        if (stage === 'matched' || stage === 'waitlisted') {
          setNotice(`יש Match עם ${candidate.firstName}! הצ׳אט נפתח.`)
          onMatched()
        } else {
          setNotice(`${candidate.firstName} נוסף/ה לרשימת ההתאמות הפוטנציאליות. אם גם הוא/היא יסמן/תסמן עניין, ייפתח צ׳אט.`)
        }
      }
      window.setTimeout(() => {
        setCandidates((previous) => previous.filter((item) => item.workerId !== candidate.workerId))
        setDragX(0)
        setSwipeExit(null)
      }, 180)
    } catch (caught) {
      setError(errorMessage(caught, 'שמירת ההחלקה נכשלה.'))
      setDragX(0)
      setSwipeExit(null)
    }
  }

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start || event.pointerId !== start.pointerId) return
    setIsDragging(false)
    const deltaX = event.clientX - start.x
    const shouldSwipe = dragLockedRef.current && Math.abs(deltaX) > 90
    dragStartRef.current = null
    dragLockedRef.current = false
    if (shouldSwipe) void swipe(deltaX > 0 ? 'right' : 'left')
    else setDragX(0)
  }

  return (
    <section className="panel worker-grid jobs-layout">
      <article className="card swipe-card">
        <h2>כרטיסיות מועמדים</h2>
        <label>
          משרה
          <select value={jobId ?? ''} onChange={(event) => onSelectJob(Number(event.target.value))}>
            {openJobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} · {job.city}
              </option>
            ))}
          </select>
        </label>
        <div className="swipe-actions compact">
          <button type="button" className="ghost" onClick={() => void swipe('left')} disabled={!candidate || !!swipeExit}>
            פסילה
          </button>
          <button type="button" className="primary" onClick={() => void swipe('right')} disabled={!candidate || !!swipeExit}>
            מתאים/ה
          </button>
        </div>
        {notice && <p className="status-box" role="status" aria-live="polite">{notice}</p>}
        {error && <p className="error-text" role="alert" aria-live="assertive">{error}</p>}
        {loading ? (
          <p className="empty">טוען מועמדים...</p>
        ) : candidate ? (
          <div
            className={`swipe-stage ${swipeMood} ${isDragging ? 'dragging' : ''}`}
            role="group"
            aria-label={`כרטיס מועמד/ת ${candidate.firstName}. אפשר לגרור, או לבחור פסילה או התאמה.`}
            tabIndex={0}
            onPointerDown={(event) => {
              if (swipeExit || (event.target as HTMLElement).closest('button, a, input, select, textarea')) return
              dragStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
              dragLockedRef.current = false
            }}
            onPointerMove={(event) => {
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
            }}
            onPointerUp={finishDrag}
            onPointerCancel={(event) => {
              if (dragStartRef.current?.pointerId !== event.pointerId) return
              dragStartRef.current = null
              dragLockedRef.current = false
              setIsDragging(false)
              setDragX(0)
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || swipeExit) return
              if (event.key === 'ArrowRight') { event.preventDefault(); void swipe('right') }
              if (event.key === 'ArrowLeft') { event.preventDefault(); void swipe('left') }
            }}
          >
            {candidates[1] && <div className="swipe-next-shadow" aria-hidden="true" />}
            <div
              className={`swipe-card-body ${swipeExit ? `exit-${swipeExit}` : ''}`}
              style={{
                transform: `translateX(${dragX}px) rotate(${dragX * 0.045}deg)`,
                transition: isDragging ? 'none' : 'transform 220ms ease',
              }}
            >
              <div className="pill-row">
                {candidate.likedJob && <span className="pill fit-exact">סימן/ה עניין במשרה</span>}
                {candidate.isSponsored && <span className="pill sponsored">פרופיל מקודם</span>}
                <span className={`pill ${candidate.reliabilityScore < LOW_RELIABILITY ? 'fit-low' : ''}`}>
                  מדד אמינות {candidate.reliabilityScore}
                </span>
                <span className="pill">{formatRating(candidate.ratingCount ? candidate.rating : null, candidate.ratingCount)}</span>
                {candidate.distanceKm !== null && <span className="pill">{candidate.distanceKm} ק״מ מהמשרה</span>}
              </div>
              <h3>
                {candidate.firstName}, {candidate.age}
              </h3>
              <p>{candidate.bio || 'לא נוסף תיאור ניסיון.'}</p>
              <ul>
                <li>גר/ה ב{candidate.city ?? '—'}</li>
                <li>משמרות שהושלמו ב-ShiftTed: {candidate.completedShifts}</li>
                <li>
                  תחומים: {candidate.isFlexible ? 'פתוח/ה לכל התחומים' : candidate.categories.join(', ') || '—'}
                </li>
                {candidate.licenses.length > 0 && <li>רישיונות: {candidate.licenses.join(', ')}</li>}
                {!candidate.hasRequiredLicense && <li className="error-text">חסר רישיון נדרש לתחום {selectedJob?.category}</li>}
              </ul>
              <div className="swipe-indicators">
                <span className={`swipe-badge no ${dragX < -24 ? 'show' : ''}`}>פסילה</span>
                <span className={`swipe-badge yes ${dragX > 24 ? 'show' : ''}`}>מתאים/ה</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty">אין כרגע מועמדים חדשים למשרה הזו.</p>
            <button type="button" className="ghost" onClick={() => setReloadKey((key) => key + 1)}>
              רענון
            </button>
          </div>
        )}
      </article>

      <aside className="card">
        <h2>איך מסודרים המועמדים?</h2>
        <ul className="landing-list">
          <li>מועמדים עם מדד אמינות מתחת ל-{LOW_RELIABILITY} מוצגים אחרונים</li>
          <li>קודם מי שכבר סימן/ה עניין במשרה</li>
          <li>אחר כך פרופילים מקודמים, מדד אמינות גבוה ומרחק קצר</li>
          <li>מוצגים גם מועמדים שפתוחים לכל התחומים וגם מועמדים חדשים שעוד אין להם דירוג</li>
          <li>שמות משפחה ופרטי קשר מוסתרים עד שמתחילים לעבוד דרך הפלטפורמה</li>
        </ul>
        <p className="empty">{candidates.length} מועמדים ממתינים למשרה זו.</p>
      </aside>
    </section>
  )
}
