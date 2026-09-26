import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import './App.css'
import type {
  AdminOverview,
  AdminUserRow,
  Application,
  ApplicationState,
  AuthUser,
  EmployerPlan,
  EmploymentType,
  Job,
  Region,
  ShiftWindow,
  TrustReportRow,
  UserRole,
  WorkerPreference,
  WorkerPreferenceInput,
  WorkerProfile,
} from './types'

const shiftLabels: Record<ShiftWindow, string> = {
  morning: 'בוקר',
  afternoon: 'צהריים',
  evening: 'ערב',
  night: 'לילה',
}

type AuthMode = 'login' | 'register'
type WorkerTab = 'profile' | 'preferences' | 'jobs'
type EmployerTab = 'publish' | 'chat' | 'events'

const employmentTypeLabels: Record<EmploymentType, string> = {
  temporary: 'משרה זמנית',
  permanent: 'משרה קבועה',
}

const regionLabels: Record<Region, string> = {
  north: 'צפון',
  haifa: 'חיפה והקריות',
  sharon: 'שרון',
  center: 'מרכז',
  tel_aviv: 'תל אביב וגוש דן',
  jerusalem: 'ירושלים והסביבה',
  shfela: 'שפלה',
  south: 'דרום',
}

const shiftOptions = Object.keys(shiftLabels) as ShiftWindow[]
const regionOptions = Object.keys(regionLabels) as Region[]

const emptyPreferenceForm: WorkerPreferenceInput = {
  employmentType: 'temporary',
  minHourlyPay: 35,
  preferredShifts: [],
  regions: [],
  availableDates: [],
  transportOnly: false,
}

const toggleValue = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

const matchesPreference = (job: Job, preference: WorkerPreferenceInput) => {
  if (job.employmentType !== preference.employmentType) {
    return false
  }
  if (job.hourlyPay < preference.minHourlyPay) {
    return false
  }
  if (preference.preferredShifts.length > 0 && !preference.preferredShifts.includes(job.shift)) {
    return false
  }
  if (preference.regions.length > 0 && (!job.region || !preference.regions.includes(job.region))) {
    return false
  }
  if (preference.transportOnly && !job.transportOffered) {
    return false
  }
  // Dates only matter for one-off jobs; permanent jobs just have a start date.
  if (job.employmentType === 'temporary' && !preference.availableDates.includes(job.date)) {
    return false
  }
  return true
}

// 2026-09-15 -> 15/09
const shortDate = (value: string) => value.split('-').reverse().slice(0, 2).join('/')

function PreferenceSummary({ preference }: { preference: WorkerPreference }) {
  return (
    <div>
      <strong>{employmentTypeLabels[preference.employmentType]}</strong>
      <p>שכר מינימלי: {preference.minHourlyPay} ש"ח לשעה</p>
      <p>
        שעות:{' '}
        {preference.preferredShifts.length > 0
          ? preference.preferredShifts.map((shift) => shiftLabels[shift]).join(', ')
          : 'כל השעות'}
      </p>
      <p>
        אזור:{' '}
        {preference.regions.length > 0
          ? preference.regions.map((region) => regionLabels[region]).join(', ')
          : 'כל הארץ'}
      </p>
      {preference.employmentType === 'temporary' && (
        <p>תאריכים: {preference.availableDates.map(shortDate).join(', ')}</p>
      )}
      {preference.transportOnly && <p>רק עם הסעה או מימון נסיעה</p>}
    </div>
  )
}

type ChatMessage = {
  id: string
  from: 'worker' | 'employer'
  text: string
  sentAt: string
}

type JobChatThread = {
  jobId: number
  jobTitle: string
  employerName: string
  messages: ChatMessage[]
}

type EmployerCandidateThread = {
  applicationId: number
  jobId: number
  workerId: number
  workerName: string
  jobTitle: string
  messages: ChatMessage[]
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

const dayNames = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

const dateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function App() {
  const [view, setView] = useState<'worker' | 'employer' | 'admin'>('worker')
  const [workerTab, setWorkerTab] = useState<WorkerTab>('jobs')
  const [designMood, setDesignMood] = useState<'sunset' | 'ocean'>('sunset')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authLoading, setAuthLoading] = useState(false)
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    role: 'worker' as Exclude<UserRole, 'admin'>,
    fullName: '',
    displayName: '',
    city: 'תל אביב',
    age: 20,
  })
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null)

  const [preferenceForm, setPreferenceForm] = useState<WorkerPreferenceInput>(emptyPreferenceForm)
  const [preferencesMessage, setPreferencesMessage] = useState('')
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const current = new Date()
    return new Date(current.getFullYear(), current.getMonth(), 1)
  })

  const [cardsIndex, setCardsIndex] = useState(0)
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [swipeExit, setSwipeExit] = useState<'left' | 'right' | null>(null)
  const [swipeHistory, setSwipeHistory] = useState<number[]>([])
  const [likedJobIds, setLikedJobIds] = useState<number[]>([])
  const [chatThreads, setChatThreads] = useState<JobChatThread[]>([])
  const [activeChatJobId, setActiveChatJobId] = useState<number | null>(null)
  const [chatInput, setChatInput] = useState('')
  const dragStartXRef = useRef<number | null>(null)

  const [jobs, setJobs] = useState<Job[]>([])
  const [workers, setWorkers] = useState<WorkerProfile[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [plans, setPlans] = useState<EmployerPlan[]>([])
  const [currentWorkerId, setCurrentWorkerId] = useState<number | null>(null)

  const [activePlan, setActivePlan] = useState<EmployerPlan['id']>('pro')
  const [employerTab, setEmployerTab] = useState<EmployerTab>('publish')
  const [isEmployerSubscribed, setIsEmployerSubscribed] = useState(false)
  const [employerChatThreads, setEmployerChatThreads] = useState<EmployerCandidateThread[]>([])
  const [activeEmployerChatId, setActiveEmployerChatId] = useState<number | null>(null)
  const [employerChatInput, setEmployerChatInput] = useState('')
  const [requiredWorkersByJob, setRequiredWorkersByJob] = useState<Record<number, number>>({})
  const [selectedJobId, setSelectedJobId] = useState<number>(0)
  const [docLink, setDocLink] = useState('https://example.com/form-101')
  const [docMessage, setDocMessage] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [reviewScore, setReviewScore] = useState(5)
  const [reviewComment, setReviewComment] = useState('')

  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([])
  const [trustRows, setTrustRows] = useState<TrustReportRow[]>([])

  const [publishForm, setPublishForm] = useState({
    title: '',
    category: 'אירועים',
    city: 'תל אביב',
    region: 'tel_aviv' as Region,
    employmentType: 'temporary' as EmploymentType,
    date: '2026-09-15',
    shift: 'evening' as ShiftWindow,
    hourlyPay: 60,
    transportOffered: false,
    transportFrom: '',
  })

  const loadBootstrap = async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await api.getBootstrap()
      setJobs(payload.jobs)
      setWorkers(payload.workers)
      setApplications(payload.applications)
      setPlans(payload.plans)
      setCurrentWorkerId(payload.currentWorkerId)
      setSelectedJobId(payload.jobs[0]?.id ?? 0)
    } catch {
      setError('לא הצלחנו להתחבר לשרת.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBootstrap()
  }, [])

  useEffect(() => {
    let isMounted = true

    const hydrateSession = async () => {
      try {
        const session = await api.getSession()
        if (!session) {
          if (isMounted) {
            setSessionUser(null)
          }
          return
        }

        const user = await api.getCurrentUser()
        if (!isMounted) {
          return
        }
        setSessionUser(user)
        setView(user.role)
      } catch {
        if (isMounted) {
          setSessionUser(null)
        }
      }
    }

    const unsubscribe = api.onAuthStateChange((user) => {
      if (!isMounted) {
        return
      }
      setSessionUser(user)
      if (user) {
        setView(user.role)
      }
    })

    void hydrateSession()

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const refreshAdminOverview = async () => {
    try {
      const [overview, users, trust] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminUsers(),
        api.getTrustReport(),
      ])
      setAdminOverview(overview)
      setAdminUsers(users)
      setTrustRows(trust.rows)
    } catch {
      setError('טעינת נתוני אדמין נכשלה.')
    }
  }

  useEffect(() => {
    if (view === 'admin' && sessionUser?.role === 'admin') {
      void refreshAdminOverview()
    }
  }, [view, sessionUser?.role])

  useEffect(() => {
    if (typeof window === 'undefined' || !sessionUser || sessionUser.role !== 'employer') {
      return
    }

    const key = `serveit.employer.subscription.${sessionUser.id}`
    const stored = window.localStorage.getItem(key)
    if (!stored) {
      setIsEmployerSubscribed(false)
      return
    }

    setIsEmployerSubscribed(stored === 'active')
  }, [sessionUser])

  useEffect(() => {
    if (typeof window === 'undefined' || !sessionUser || sessionUser.role !== 'employer') {
      return
    }
    const key = `serveit.employer.subscription.${sessionUser.id}`
    window.localStorage.setItem(key, isEmployerSubscribed ? 'active' : 'inactive')
  }, [isEmployerSubscribed, sessionUser])

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

  const currentWorker = workers.find((worker) => worker.id === (sessionUser?.id ?? currentWorkerId))

  const savedPreferences = useMemo(() => currentWorker?.preferences ?? [], [currentWorker])
  const formIsTemporary = preferenceForm.employmentType === 'temporary'

  // With no saved preferences the worker is open to everything; otherwise a job
  // needs to match at least one of them.
  const filteredJobs = useMemo(() => {
    if (savedPreferences.length === 0) {
      return jobs
    }
    return jobs.filter((job) => savedPreferences.some((preference) => matchesPreference(job, preference)))
  }, [jobs, savedPreferences])

  const effectiveCardIndex = cardsIndex > filteredJobs.length ? filteredJobs.length : cardsIndex
  const visibleCard = filteredJobs[effectiveCardIndex]

  const pricedPlans = useMemo(
    () =>
      plans.map((plan) => ({
        ...plan,
        monthlyPrice: plan.id === 'starter' ? 50 : plan.id === 'pro' ? 80 : 80,
      })),
    [plans],
  )

  const employerName = sessionUser?.displayName ?? ''
  const employerJobs = useMemo(
    () => jobs.filter((job) => (employerName ? job.employerName === employerName : false)),
    [jobs, employerName],
  )
  const employerJobIds = useMemo(() => new Set(employerJobs.map((job) => job.id)), [employerJobs])
  const employerApplications = useMemo(
    () => applications.filter((application) => employerJobIds.has(application.jobId)),
    [applications, employerJobIds],
  )
  const pendingForEmployer = employerApplications.filter((application) => application.state === 'pending')
  const approvedForEmployer = employerApplications.filter((application) => application.state === 'approved')
  const reviewedCandidate = approvedForEmployer[0]
  const documentEligibleJobs = employerJobs.filter((job) =>
    approvedForEmployer.some((application) => application.jobId === job.id),
  )

  const employerStaffingRows = employerJobs.map((job) => {
    const required = requiredWorkersByJob[job.id] ?? 3
    const approved = approvedForEmployer.filter((application) => application.jobId === job.id).length
    return {
      job,
      required,
      approved,
      missing: Math.max(0, required - approved),
    }
  })

  const effectiveEmployerChatId = activeEmployerChatId ?? employerChatThreads[0]?.applicationId ?? null
  const activeEmployerChatThread = useMemo(
    () => employerChatThreads.find((thread) => thread.applicationId === effectiveEmployerChatId) ?? null,
    [employerChatThreads, effectiveEmployerChatId],
  )
  const effectiveSelectedJobId = documentEligibleJobs.some((job) => job.id === selectedJobId)
    ? selectedJobId
    : (documentEligibleJobs[0]?.id ?? 0)

  const likedJobs = useMemo(
    () => likedJobIds.map((jobId) => jobs.find((job) => job.id === jobId)).filter((job): job is Job => !!job),
    [likedJobIds, jobs],
  )

  const activeChatThread = useMemo(
    () => chatThreads.find((thread) => thread.jobId === activeChatJobId) ?? null,
    [chatThreads, activeChatJobId],
  )

  const handleAuthSubmit = async () => {
    setAuthLoading(true)
    setError('')

    try {
      if (authMode === 'login') {
        await api.login({ email: authForm.email, password: authForm.password })
      } else {
        if (authForm.role === 'worker' && authForm.fullName.trim().length < 2) {
          setError('בהרשמת עובד צריך להזין שם מלא של לפחות 2 תווים.')
          return
        }

        if (authForm.role === 'employer' && authForm.displayName.trim().length < 2) {
          setError('בהרשמת מעסיק צריך להזין שם עסק של לפחות 2 תווים.')
          return
        }

        const result = await api.register({
          email: authForm.email,
          password: authForm.password,
          role: authForm.role,
          fullName: authForm.fullName.trim() || undefined,
          displayName: authForm.displayName.trim() || undefined,
          city: authForm.city.trim() || undefined,
          age: authForm.age,
        })

        if (result.requiresEmailConfirmation) {
          setError('ההרשמה נקלטה. צריך לאשר את כתובת האימייל במייל שנשלח ואז להתחבר.')
          setAuthMode('login')
          return
        }
      }

      const user = await api.getCurrentUser()
      setSessionUser(user)
      setView(user.role)
      await loadBootstrap()
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : ''
      if (message) {
        setError(message)
      } else {
        setError('התחברות/הרשמה נכשלה. בדוק פרטים ונסה שוב.')
      }
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    await api.logout()
    setSessionUser(null)
    setView('worker')
  }

  const createOrUpdateChatThread = (job: Job, workerName: string) => {
    setChatThreads((previous) => {
      const existing = previous.find((thread) => thread.jobId === job.id)
      if (existing) {
        return previous
      }

      const starterMessage: ChatMessage = {
        id: `m-${job.id}-hello`,
        from: 'employer',
        text: `היי ${workerName}, תודה על ההתעניינות במשרה "${job.title}". נשמח להמשיך בתיאום פרטים.`,
        sentAt: new Date().toISOString(),
      }

      return [
        ...previous,
        {
          jobId: job.id,
          jobTitle: job.title,
          employerName: job.employerName,
          messages: [starterMessage],
        },
      ]
    })
    setActiveChatJobId(job.id)
  }

  const sendChatMessage = () => {
    if (!activeChatThread || !chatInput.trim()) {
      return
    }

    const messageText = chatInput.trim()
    const workerMessage: ChatMessage = {
      id: `w-${Date.now()}`,
      from: 'worker',
      text: messageText,
      sentAt: new Date().toISOString(),
    }

    setChatThreads((previous) =>
      previous.map((thread) =>
        thread.jobId === activeChatThread.jobId
          ? { ...thread, messages: [...thread.messages, workerMessage] }
          : thread,
      ),
    )
    setChatInput('')

    window.setTimeout(() => {
      const employerReply: ChatMessage = {
        id: `e-${Date.now()}`,
        from: 'employer',
        text: 'מעולה, שלחנו לך עכשיו את פרטי המשמרת והכתובת. אם מתאים לך נשריין אותך.',
        sentAt: new Date().toISOString(),
      }

      setChatThreads((previous) =>
        previous.map((thread) =>
          thread.jobId === activeChatThread.jobId
            ? { ...thread, messages: [...thread.messages, employerReply] }
            : thread,
        ),
      )
    }, 550)
  }

  useEffect(() => {
    if (view !== 'employer') {
      return
    }

    setEmployerChatThreads((previous) => {
      const next = [...previous]
      for (const application of employerApplications) {
        if (next.some((thread) => thread.applicationId === application.id)) {
          continue
        }

        const worker = workers.find((entry) => entry.id === application.workerId)
        const job = jobs.find((entry) => entry.id === application.jobId)
        next.push({
          applicationId: application.id,
          jobId: application.jobId,
          workerId: application.workerId,
          workerName: worker?.fullName ?? `עובד #${application.workerId}`,
          jobTitle: job?.title ?? `משרה #${application.jobId}`,
          messages: [
            {
              id: `employer-init-${application.id}`,
              from: 'employer',
              text: `שלום, ראינו את המועמדות שלך ל${job?.title ?? 'משרה'}. נשמח לתאם פרטים.`,
              sentAt: new Date().toISOString(),
            },
          ],
        })
      }

      return next.filter((thread) =>
        employerApplications.some((application) => application.id === thread.applicationId),
      )
    })
  }, [view, employerApplications, workers, jobs])

  const sendEmployerChatMessage = () => {
    if (!activeEmployerChatThread || !employerChatInput.trim()) {
      return
    }

    const messageText = employerChatInput.trim()
    const employerMessage: ChatMessage = {
      id: `emp-${Date.now()}`,
      from: 'employer',
      text: messageText,
      sentAt: new Date().toISOString(),
    }

    setEmployerChatThreads((previous) =>
      previous.map((thread) =>
        thread.applicationId === activeEmployerChatThread.applicationId
          ? { ...thread, messages: [...thread.messages, employerMessage] }
          : thread,
      ),
    )
    setEmployerChatInput('')

    window.setTimeout(() => {
      const workerReply: ChatMessage = {
        id: `worker-${Date.now()}`,
        from: 'worker',
        text: 'מצוין, קיבלתי. תודה, מחכה לעדכון סופי על המשמרת.',
        sentAt: new Date().toISOString(),
      }

      setEmployerChatThreads((previous) =>
        previous.map((thread) =>
          thread.applicationId === activeEmployerChatThread.applicationId
            ? { ...thread, messages: [...thread.messages, workerReply] }
            : thread,
        ),
      )
    }, 700)
  }

  const updateRequiredWorkers = (jobId: number, count: number) => {
    const safeCount = Number.isNaN(count) ? 1 : Math.max(1, Math.min(40, count))
    setRequiredWorkersByJob((previous) => ({ ...previous, [jobId]: safeCount }))
  }

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (!visibleCard || swipeExit) {
      return
    }

    if (direction === 'right' && !currentWorker) {
      return
    }

    const cardForAction = visibleCard
    const activeJobId = cardForAction.id
    setSwipeExit(direction)
    setDragX(direction === 'right' ? 220 : -220)
    setSwipeHistory((previous) => [...previous, activeJobId])

    window.setTimeout(async () => {
      setCardsIndex((previous) => previous + 1)
      setDragX(0)
      setSwipeExit(null)
    }, 180)

    if (direction === 'right') {
      const workerDisplayName = currentWorker?.fullName ?? sessionUser?.fullName ?? 'עובד/ת'
      setLikedJobIds((previous) =>
        previous.includes(activeJobId) ? previous : [...previous, activeJobId],
      )
      createOrUpdateChatThread(cardForAction, workerDisplayName)

      try {
        const next = await api.createApplication({
          jobId: activeJobId,
          workerId: currentWorker!.id,
        })

        setApplications((previous) => {
          const existingIndex = previous.findIndex((application) => application.id === next.id)
          if (existingIndex >= 0) {
            const copy = [...previous]
            copy[existingIndex] = next
            return copy
          }

          return [...previous, next]
        })
      } catch {
        setError('שליחת המועמדות נכשלה. נסה שוב.')
      }
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

  const handleRewind = () => {
    if (swipeHistory.length === 0 || swipeExit) {
      return
    }

    const previousJobId = swipeHistory[swipeHistory.length - 1]
    const previousIndex = filteredJobs.findIndex((job) => job.id === previousJobId)
    if (previousIndex < 0) {
      setSwipeHistory((previous) => previous.slice(0, -1))
      return
    }

    setCardsIndex(previousIndex)
    setDragX(0)
    setSwipeHistory((previous) => previous.slice(0, -1))
  }

  const updateApplicationState = async (id: number, state: ApplicationState) => {
    try {
      const next = await api.updateApplication(id, state)
      setApplications((previous) =>
        previous.map((application) => (application.id === next.id ? next : application)),
      )
    } catch {
      setError('עדכון סטטוס מועמדות נכשל.')
    }
  }

  const cancelApplication = async (id: number) => {
    if (!cancelReason.trim()) {
      return
    }

    try {
      const next = await api.cancelApplication(id, cancelReason)
      setApplications((previous) =>
        previous.map((application) => (application.id === next.id ? next : application)),
      )
      setCancelReason('')
    } catch {
      setError('ביטול המועמדות נכשל.')
    }
  }

  const submitReview = async (applicationId: number) => {
    try {
      await api.reviewApplication(applicationId, reviewScore, reviewComment)
      setReviewComment('')
      setReviewScore(5)
      await loadBootstrap()
    } catch {
      setError('שליחת הדירוג נכשלה.')
    }
  }

  const publishJob = async () => {
    if (!publishForm.title.trim()) {
      return
    }

    try {
      const nextJob = await api.createJob({
        title: publishForm.title,
        category: publishForm.category,
        city: publishForm.city,
        region: publishForm.region,
        employmentType: publishForm.employmentType,
        date: publishForm.date,
        shift: publishForm.shift,
        hourlyPay: Number(publishForm.hourlyPay),
        transportOffered: publishForm.transportOffered,
        transportFrom: publishForm.transportFrom || undefined,
      })

      setJobs((previous) => [nextJob, ...previous])
      setSelectedJobId(nextJob.id)
      setPublishForm((previous) => ({ ...previous, title: '', hourlyPay: 60, transportFrom: '' }))
    } catch {
      setError('פרסום המשרה נכשל. בדוק נתונים ונסה שוב.')
    }
  }

  const sendDocumentLink = async (targetJobId: number) => {
    if (!docLink.trim()) {
      return
    }

    if (targetJobId === 0) {
      return
    }

    try {
      const result = await api.sendDocuments({
        jobId: targetJobId,
        documentUrl: docLink,
      })
      setDocMessage(result.message)
    } catch {
      setError('שליחת המסמכים נכשלה. ודא שמדובר בקישור תקין.')
    }
  }

  const handleVerifyWorker = async (userId: number) => {
    try {
      await api.verifyWorker(userId, 'verified')
      await Promise.all([refreshAdminOverview(), loadBootstrap()])
    } catch {
      setError('אימות עובד נכשל.')
    }
  }

  const handleVerifyEmployer = async (userId: number) => {
    try {
      await api.verifyEmployer(userId, true)
      await Promise.all([refreshAdminOverview(), loadBootstrap()])
    } catch {
      setError('אימות מעסיק נכשל.')
    }
  }

  const handleSuspensionToggle = async (user: AdminUserRow) => {
    try {
      await api.setUserSuspension(
        user.id,
        !user.isSuspended,
        user.isSuspended ? undefined : 'השעיה ידנית ע"י אדמין',
      )
      await refreshAdminOverview()
    } catch {
      setError('עדכון השעיה נכשל.')
    }
  }

  const handleRecalculateSuspensions = async () => {
    try {
      await api.recalculateSuspensions()
      await refreshAdminOverview()
      await loadBootstrap()
    } catch {
      setError('חישוב השעיות אוטומטי נכשל.')
    }
  }

  const updatePreferenceForm = (patch: Partial<WorkerPreferenceInput>) => {
    setPreferenceForm((previous) => ({ ...previous, ...patch }))
    setPreferencesMessage('')
  }

  const toggleAvailabilityDate = (selectedDate: Date) => {
    updatePreferenceForm({
      availableDates: toggleValue(preferenceForm.availableDates, dateKey(selectedDate)).sort(),
    })
  }

  const setWorkerPreferences = (workerId: number, update: (previous: WorkerPreference[]) => WorkerPreference[]) => {
    setWorkers((previous) =>
      previous.map((worker) => (worker.id === workerId ? { ...worker, preferences: update(worker.preferences) } : worker)),
    )
  }

  const addWorkerPreference = async () => {
    if (!currentWorker) {
      setPreferencesMessage('לא נמצא פרופיל עובד לשמירה.')
      return
    }
    if (formIsTemporary && preferenceForm.availableDates.length === 0) {
      setPreferencesMessage('למשרה זמנית צריך לבחור לפחות תאריך אחד בלוח השנה.')
      return
    }

    try {
      const saved = await api.addWorkerPreference(preferenceForm)
      setWorkerPreferences(currentWorker.id, (previous) => [...previous, saved])
      setPreferenceForm(emptyPreferenceForm)
      setPreferencesMessage('ההעדפה נשמרה. אפשר להוסיף עוד העדפות.')
    } catch {
      setError('שמירת ההעדפה נכשלה.')
    }
  }

  const removeWorkerPreference = async (preferenceId: number) => {
    if (!currentWorker) {
      return
    }
    try {
      await api.deleteWorkerPreference(preferenceId)
      setWorkerPreferences(currentWorker.id, (previous) => previous.filter((item) => item.id !== preferenceId))
    } catch {
      setError('מחיקת ההעדפה נכשלה.')
    }
  }

  const changeMonth = (direction: -1 | 1) => {
    setCalendarMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + direction, 1),
    )
  }

  const activePlanData = pricedPlans.find((plan) => plan.id === activePlan) ?? null
  const usedOpenings = employerJobs.length

  if (!sessionUser) {
    return (
      <main className={`app ${designMood === 'ocean' ? 'theme-ocean' : ''}`} dir="rtl">
        <section className="card auth-card">
          <h2>{authMode === 'login' ? 'כניסה' : 'הרשמה'}</h2>
          <p className="subtitle">נכנסים ומתחילים למצוא עבודה או לפרסם משרות.</p>
          <label>
            אימייל
            <input
              value={authForm.email}
              onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label>
            סיסמה
            <input
              type="password"
              value={authForm.password}
              onChange={(event) =>
                setAuthForm((prev) => ({ ...prev, password: event.target.value }))
              }
            />
          </label>

          {authMode === 'register' && (
            <>
              <label>
                תפקיד
                <select
                  value={authForm.role}
                  onChange={(event) =>
                    setAuthForm((prev) => ({
                      ...prev,
                      role: event.target.value as Exclude<UserRole, 'admin'>,
                    }))
                  }
                >
                  <option value="worker">עובד</option>
                  <option value="employer">מעסיק</option>
                </select>
              </label>
              {authForm.role === 'worker' ? (
                <>
                  <label>
                    שם מלא
                    <input
                      value={authForm.fullName}
                      onChange={(event) =>
                        setAuthForm((prev) => ({ ...prev, fullName: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    עיר
                    <input
                      value={authForm.city}
                      onChange={(event) =>
                        setAuthForm((prev) => ({ ...prev, city: event.target.value }))
                      }
                    />
                  </label>
                </>
              ) : (
                <label>
                  שם עסק
                  <input
                    value={authForm.displayName}
                    onChange={(event) =>
                      setAuthForm((prev) => ({ ...prev, displayName: event.target.value }))
                    }
                  />
                </label>
              )}
            </>
          )}

          <div className="swipe-actions">
            <button type="button" className="primary" onClick={handleAuthSubmit} disabled={authLoading}>
              {authLoading ? 'טוען...' : authMode === 'login' ? 'התחבר' : 'צור חשבון'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setAuthMode((mode) => (mode === 'login' ? 'register' : 'login'))}
            >
              {authMode === 'login' ? 'אין לי חשבון' : 'כבר יש לי חשבון'}
            </button>
          </div>

          {error && <p className="empty">{error}</p>}
        </section>
      </main>
    )
  }

  if (loading) {
    return (
      <main className={`app ${designMood === 'ocean' ? 'theme-ocean' : ''}`} dir="rtl">
        <section className="card">
          <h2>טוען נתונים...</h2>
        </section>
      </main>
    )
  }

  const nextCard = filteredJobs[effectiveCardIndex + 1]
  const swipeMood = swipeExit ?? (dragX > 25 ? 'right' : dragX < -25 ? 'left' : 'idle')

  return (
    <main className={`app ${designMood === 'ocean' ? 'theme-ocean' : ''}`} dir="rtl">
      <header className="topbar">
        <div>
          <p className="eyebrow">serveit</p>
          <h1>מוצאים עבודה לפי הווייב שלך</h1>
          <p className="subtitle">{sessionUser.fullName ?? sessionUser.displayName ?? sessionUser.email}</p>
          <div className="pulse-stats">
            <span>{filteredJobs.length} משרות בפיד</span>
            <span>{applications.filter((item) => item.state === 'approved').length} מאצ׳ים פעילים</span>
            <span>{savedPreferences.length} העדפות שמורות</span>
          </div>
        </div>
        <div className="role-toggle">
          <button
            type="button"
            onClick={() => setView('worker')}
            className={view === 'worker' ? 'active' : ''}
            disabled={sessionUser.role !== 'worker' && sessionUser.role !== 'admin'}
          >
            עובד
          </button>
          <button
            type="button"
            onClick={() => setView('employer')}
            className={view === 'employer' ? 'active' : ''}
            disabled={sessionUser.role !== 'employer' && sessionUser.role !== 'admin'}
          >
            מעסיק
          </button>
          <button
            type="button"
            onClick={() => setView('admin')}
            className={view === 'admin' ? 'active' : ''}
            disabled={sessionUser.role !== 'admin'}
          >
            אדמין
          </button>
        </div>
      </header>

      <section className="card quick-actions">
        <div className="swipe-actions quick-tools">
          <div className="theme-switch" role="group" aria-label="Theme switcher">
            <button
              type="button"
              className={designMood === 'sunset' ? 'active' : ''}
              onClick={() => setDesignMood('sunset')}
            >
              Sunset Pop
            </button>
            <button
              type="button"
              className={designMood === 'ocean' ? 'active' : ''}
              onClick={() => setDesignMood('ocean')}
            >
              Ocean Glow
            </button>
          </div>
          <button type="button" className="ghost" onClick={() => void loadBootstrap()}>
            רענון
          </button>
          <button type="button" className="ghost" onClick={() => void handleLogout()}>
            התנתקות
          </button>
        </div>
      </section>

      {error && (
        <section className="card">
          <p className="empty">{error}</p>
        </section>
      )}

      {view === 'worker' && (
        <section className="worker-shell">
          <nav className="worker-dock">
            <button
              type="button"
              className={workerTab === 'profile' ? 'active' : ''}
              onClick={() => setWorkerTab('profile')}
            >
              פרופיל
            </button>
            <button
              type="button"
              className={workerTab === 'preferences' ? 'active' : ''}
              onClick={() => setWorkerTab('preferences')}
            >
              העדפות
            </button>
            <button
              type="button"
              className={workerTab === 'jobs' ? 'active' : ''}
              onClick={() => setWorkerTab('jobs')}
            >
              משרות
            </button>
          </nav>

          {workerTab === 'profile' && (
            <section className="panel worker-grid profile-layout">
              <article className="card">
                <h2>הפרופיל שלי</h2>
                <p>שם: {currentWorker?.fullName ?? '—'}</p>
                <p>עיר: {currentWorker?.city ?? '—'}</p>
                <p>דירוג: {currentWorker?.rating ?? '-'} / 5</p>
                <p>אימות: {currentWorker?.verificationLevel === 'verified' ? 'מאומת' : 'בסיסי'}</p>
                <h3>מה אני מחפש/ת</h3>
                {savedPreferences.length === 0 ? (
                  <p className="empty">פתוח/ה לכל המשרות. אפשר להוסיף העדפות בלשונית "העדפות".</p>
                ) : (
                  <div className="list">
                    {savedPreferences.map((preference) => (
                      <div key={preference.id} className="list-item">
                        <PreferenceSummary preference={preference} />
                      </div>
                    ))}
                  </div>
                )}
              </article>
              <article className="card">
                <h2>הפעילות שלי</h2>
                <p>מועמדויות: {applications.length}</p>
                <p>מאצ׳ים שאושרו: {applications.filter((item) => item.state === 'approved').length}</p>
                <p>סימנתי "כן": {likedJobs.length}</p>
                <div className="list">
                  {applications.map((application) => {
                    const job = jobs.find((entry) => entry.id === application.jobId)
                    return (
                      <div key={application.id} className="list-item">
                        <strong>{job?.title}</strong>
                        <span>סטטוס: {application.state}</span>
                      </div>
                    )
                  })}
                </div>
              </article>

              <article className="card">
                <h2>משרות שסימנתי כן</h2>
                <div className="list">
                  {likedJobs.length === 0 && <p className="empty">עדיין לא סימנת כן למשרה.</p>}
                  {likedJobs.map((job) => (
                    <div key={job.id} className="list-item fit">
                      <div>
                        <strong>{job.title}</strong>
                        <p>
                          {job.city} | {job.employerName}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          setActiveChatJobId(job.id)
                          setWorkerTab('jobs')
                        }}
                      >
                        פתח צ׳אט
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          )}

          {workerTab === 'preferences' && (
            <section className="panel worker-grid preferences-layout">
              <article className="card saved-preferences">
                <h2>ההעדפות השמורות שלי</h2>
                {savedPreferences.length === 0 ? (
                  <p className="empty">עדיין לא נשמרו העדפות, לכן מוצגות כל המשרות.</p>
                ) : (
                  <>
                    <p className="empty">בפיד יופיעו משרות שמתאימות לאחת לפחות מההעדפות.</p>
                    <div className="preference-cards">
                      {savedPreferences.map((preference) => (
                        <div key={preference.id} className="list-item">
                          <PreferenceSummary preference={preference} />
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => void removeWorkerPreference(preference.id)}
                          >
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
                <div className="choice-group">
                  <span>שעות עבודה (בלי בחירה = הכל)</span>
                  <div className="pill-row">
                    {shiftOptions.map((shift) => (
                      <button
                        key={shift}
                        type="button"
                        className={`pill ${preferenceForm.preferredShifts.includes(shift) ? 'selected' : ''}`}
                        onClick={() =>
                          updatePreferenceForm({ preferredShifts: toggleValue(preferenceForm.preferredShifts, shift) })
                        }
                      >
                        {shiftLabels[shift]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="choice-group">
                  <span>אזור (בלי בחירה = כל הארץ)</span>
                  <div className="pill-row">
                    {regionOptions.map((region) => (
                      <button
                        key={region}
                        type="button"
                        className={`pill ${preferenceForm.regions.includes(region) ? 'selected' : ''}`}
                        onClick={() => updatePreferenceForm({ regions: toggleValue(preferenceForm.regions, region) })}
                      >
                        {regionLabels[region]}
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
                {formIsTemporary && (
                  <p className="empty">סומנו {preferenceForm.availableDates.length} תאריכים בלוח השנה</p>
                )}
                <button type="button" className="primary" onClick={() => void addWorkerPreference()}>
                  שמירת העדפה
                </button>
                {preferencesMessage && <p className="status-box">{preferencesMessage}</p>}
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
                        >
                          {day.getDate()}
                        </button>
                      )
                    })}
                  </div>
                  <div className="pill-row">
                    {preferenceForm.availableDates.slice(0, 8).map((date) => (
                      <span key={date} className="pill">
                        {date}
                      </span>
                    ))}
                  </div>
                </article>
              )}
            </section>
          )}

          {workerTab === 'jobs' && (
            <section className="panel worker-grid jobs-layout">
              <article className="card swipe-card">
                <h2>החלקה על משרות</h2>
                <p className="empty">גררי את הכרטיס ימינה לעניין, שמאלה לדילוג.</p>
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
                {visibleCard ? (
                  <div
                    className={`swipe-stage ${swipeMood}`}
                    onPointerDown={(event) => {
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
                      <div className="pill-row">
                        <span className="pill">{employmentTypeLabels[visibleCard.employmentType]}</span>
                        <span className="pill">{visibleCard.category}</span>
                        <span className="pill">{shiftLabels[visibleCard.shift]}</span>
                        <span className="pill">
                          {visibleCard.city}
                          {visibleCard.region ? ` · ${regionLabels[visibleCard.region]}` : ''}
                        </span>
                      </div>
                      <h3>{visibleCard.title}</h3>
                      <p>{visibleCard.description}</p>
                      <ul>
                        <li>
                          {visibleCard.employmentType === 'permanent' ? 'תחילת עבודה' : 'תאריך'}: {visibleCard.date}
                        </li>
                        <li>שכר: {visibleCard.hourlyPay} ש"ח לשעה</li>
                        <li>מעסיק: {visibleCard.employerName}</li>
                      </ul>
                      <div className="swipe-indicators">
                        <span className={`swipe-badge no ${dragX < -24 ? 'show' : ''}`}>לא מתאים</span>
                        <span className={`swipe-badge yes ${dragX > 24 ? 'show' : ''}`}>בול בשבילי</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="empty">אין עוד משרות כרגע לפילטרים שבחרת.</p>
                )}
              </article>

              <aside className="card">
                <h2>מאצ׳ים וביטולים</h2>

                <div className="chat-box">
                  <div className="chat-header">
                    <strong>צ׳אט עם מעסיק</strong>
                    {activeChatThread && <small>{activeChatThread.employerName} | {activeChatThread.jobTitle}</small>}
                  </div>

                  {chatThreads.length > 0 ? (
                    <>
                      <div className="chat-thread-switch">
                        {chatThreads.map((thread) => (
                          <button
                            key={thread.jobId}
                            type="button"
                            className={`pill ${activeChatJobId === thread.jobId ? 'active-thread' : ''}`}
                            onClick={() => setActiveChatJobId(thread.jobId)}
                          >
                            {thread.jobTitle}
                          </button>
                        ))}
                      </div>
                      <div className="chat-messages">
                        {(activeChatThread?.messages ?? []).map((message) => (
                          <div
                            key={message.id}
                            className={`chat-message ${message.from === 'worker' ? 'mine' : 'theirs'}`}
                          >
                            {message.text}
                          </div>
                        ))}
                      </div>
                      <div className="chat-input-row">
                        <input
                          value={chatInput}
                          onChange={(event) => setChatInput(event.target.value)}
                          placeholder="כתבי למעסיק..."
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              sendChatMessage()
                            }
                          }}
                        />
                        <button type="button" className="primary" onClick={sendChatMessage}>
                          שלח
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="empty">ברגע שתסמני "כן" תיפתח כאן שיחה עם המעסיק.</p>
                  )}
                </div>

                <div className="list">
                  {applications.length === 0 && <p className="empty">עדיין לא שלחת מועמדויות.</p>}
                  {applications.map((application) => {
                    const job = jobs.find((entry) => entry.id === application.jobId)
                    return (
                      <div key={application.id} className="list-item">
                        <strong>{job?.title}</strong>
                        <span>סטטוס: {application.state}</span>
                        {application.canceledAt && (
                          <small>
                            בוטל: {application.cancellationReason} | קנס: {application.penaltyPoints}
                          </small>
                        )}
                        <label>
                          סיבת ביטול
                          <input
                            value={cancelReason}
                            onChange={(event) => setCancelReason(event.target.value)}
                            placeholder="למה לבטל?"
                          />
                        </label>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void cancelApplication(application.id)}
                        >
                          ביטול מועמדות
                        </button>
                      </div>
                    )
                  })}
                </div>
              </aside>
            </section>
          )}
        </section>
      )}

      {view === 'employer' && (
        <section className="worker-shell">
          {!isEmployerSubscribed ? (
            <article className="card">
              <h2>הרשמה למסלול מעסיק</h2>
              <p className="empty">לפני פתיחת ממשק הניהול צריך לבחור ולהפעיל מסלול.</p>
              <div className="plans">
                {pricedPlans.map((plan) => (
                  <button
                    type="button"
                    key={plan.id}
                    onClick={() => setActivePlan(plan.id)}
                    className={`plan ${activePlan === plan.id ? 'selected' : ''}`}
                  >
                    <strong>{plan.name}</strong>
                    <span>{plan.monthlyPrice} ש"ח לחודש</span>
                    <small>עד {plan.openingsLimit} משרות</small>
                  </button>
                ))}
              </div>
              <button type="button" className="primary" onClick={() => setIsEmployerSubscribed(true)}>
                הרשמה למסלול ופתיחת הממשק
              </button>
            </article>
          ) : (
            <>
              <nav className="worker-dock">
                <button
                  type="button"
                  className={employerTab === 'publish' ? 'active' : ''}
                  onClick={() => setEmployerTab('publish')}
                >
                  פרסום משרות
                </button>
                <button
                  type="button"
                  className={employerTab === 'chat' ? 'active' : ''}
                  onClick={() => setEmployerTab('chat')}
                >
                  צ׳אט מועמדים
                </button>
                <button
                  type="button"
                  className={employerTab === 'events' ? 'active' : ''}
                  onClick={() => setEmployerTab('events')}
                >
                  סטטוס אירועים
                </button>
              </nav>

              {employerTab === 'publish' && (
                <section className="panel employer-grid">
                  <article className="card">
                    <h2>מסלול פעיל</h2>
                    {activePlanData ? (
                      <p>
                        <strong>{activePlanData.name}</strong> | {activePlanData.monthlyPrice} ש"ח לחודש | ניצול{' '}
                        {usedOpenings}/{activePlanData.openingsLimit}
                      </p>
                    ) : (
                      <p className="empty">אין מסלול פעיל.</p>
                    )}
                  </article>

                  <article className="card">
                    <h2>פרסום משרה חדשה</h2>
                    <div className="form-grid">
                      <label>
                        סוג משרה
                        <select
                          value={publishForm.employmentType}
                          onChange={(event) =>
                            setPublishForm((previous) => ({
                              ...previous,
                              employmentType: event.target.value as EmploymentType,
                            }))
                          }
                        >
                          <option value="temporary">{employmentTypeLabels.temporary}</option>
                          <option value="permanent">{employmentTypeLabels.permanent}</option>
                        </select>
                      </label>
                      <label>
                        כותרת
                        <input
                          value={publishForm.title}
                          onChange={(event) =>
                            setPublishForm((previous) => ({ ...previous, title: event.target.value }))
                          }
                        />
                      </label>
                      <label>
                        קטגוריה
                        <input
                          value={publishForm.category}
                          onChange={(event) =>
                            setPublishForm((previous) => ({ ...previous, category: event.target.value }))
                          }
                        />
                      </label>
                      <label>
                        עיר
                        <input
                          value={publishForm.city}
                          onChange={(event) =>
                            setPublishForm((previous) => ({ ...previous, city: event.target.value }))
                          }
                        />
                      </label>
                      <label>
                        אזור
                        <select
                          value={publishForm.region}
                          onChange={(event) =>
                            setPublishForm((previous) => ({ ...previous, region: event.target.value as Region }))
                          }
                        >
                          {regionOptions.map((region) => (
                            <option key={region} value={region}>
                              {regionLabels[region]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {publishForm.employmentType === 'permanent' ? 'תאריך תחילת עבודה' : 'תאריך המשמרת'}
                        <input
                          type="date"
                          value={publishForm.date}
                          onChange={(event) =>
                            setPublishForm((previous) => ({ ...previous, date: event.target.value }))
                          }
                        />
                      </label>
                      <label>
                        חלון שעות
                        <select
                          value={publishForm.shift}
                          onChange={(event) =>
                            setPublishForm((previous) => ({
                              ...previous,
                              shift: event.target.value as ShiftWindow,
                            }))
                          }
                        >
                          <option value="morning">בוקר</option>
                          <option value="afternoon">צהריים</option>
                          <option value="evening">ערב</option>
                          <option value="night">לילה</option>
                        </select>
                      </label>
                      <label>
                        שכר לשעה
                        <input
                          type="number"
                          min={35}
                          value={publishForm.hourlyPay}
                          onChange={(event) =>
                            setPublishForm((previous) => ({
                              ...previous,
                              hourlyPay: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <button type="button" className="primary" onClick={() => void publishJob()}>
                      פרסם משרה
                    </button>
                  </article>

                  <article className="card">
                    <h2>שליחת מסמכים</h2>
                    <p className="empty">ניתן לשלוח לינקים רק למשרות עם מאצ׳ מאושר.</p>
                    <label>
                      בחר משרה
                      <select
                        value={effectiveSelectedJobId}
                        onChange={(event) => setSelectedJobId(Number(event.target.value))}
                      >
                        {documentEligibleJobs.length === 0 && <option value={0}>אין משרות זמינות</option>}
                        {documentEligibleJobs.map((job) => (
                          <option key={job.id} value={job.id}>
                            #{job.id} - {job.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      קישור למסמכים
                      <input value={docLink} onChange={(event) => setDocLink(event.target.value)} />
                    </label>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void sendDocumentLink(effectiveSelectedJobId)}
                      disabled={effectiveSelectedJobId === 0 || documentEligibleJobs.length === 0}
                    >
                      שלח מסמכים
                    </button>
                    {docMessage && <p className="status-box">{docMessage}</p>}

                    {reviewedCandidate && (
                      <div className="status-box" style={{ marginTop: 10 }}>
                        <h3>דירוג עובד לאחר משמרת</h3>
                        <label>
                          ציון
                          <input
                            type="number"
                            min={1}
                            max={5}
                            value={reviewScore}
                            onChange={(event) => setReviewScore(Number(event.target.value))}
                          />
                        </label>
                        <label>
                          הערה
                          <input
                            value={reviewComment}
                            onChange={(event) => setReviewComment(event.target.value)}
                            placeholder="דיוק בזמנים, שירותיות..."
                          />
                        </label>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => void submitReview(reviewedCandidate.id)}
                        >
                          שלח דירוג
                        </button>
                      </div>
                    )}
                  </article>
                </section>
              )}

              {employerTab === 'chat' && (
                <section className="panel employer-grid">
                  <article className="card">
                    <h2>אישור/דחיית מועמדים</h2>
                    <div className="list">
                      {pendingForEmployer.length === 0 && <p className="empty">אין מועמדויות ממתינות כרגע.</p>}
                      {pendingForEmployer.map((application) => {
                        const worker = workers.find((entry) => entry.id === application.workerId)
                        return (
                          <div key={application.id} className="list-item fit">
                            <div>
                              <strong>{worker?.fullName}</strong>
                              <p>
                                {worker?.city} | דירוג {worker?.rating} |{' '}
                                {worker?.verificationLevel === 'verified' ? 'מאומת' : 'בסיסי'}
                              </p>
                            </div>
                            <div className="fit-actions">
                              <button
                                type="button"
                                className="primary"
                                onClick={() => void updateApplicationState(application.id, 'approved')}
                              >
                                אשר מאץ׳
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => void updateApplicationState(application.id, 'rejected')}
                              >
                                דחה
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </article>

                  <article className="card">
                    <h2>צ׳אט עם מועמדים</h2>
                    {employerChatThreads.length === 0 ? (
                      <p className="empty">אין עדיין מועמדים לשיחה.</p>
                    ) : (
                      <>
                        <div className="chat-thread-switch">
                          {employerChatThreads.map((thread) => {
                            const appState =
                              applications.find((item) => item.id === thread.applicationId)?.state ?? 'pending'
                            return (
                              <button
                                key={thread.applicationId}
                                type="button"
                                className={`pill ${effectiveEmployerChatId === thread.applicationId ? 'active-thread' : ''}`}
                                onClick={() => setActiveEmployerChatId(thread.applicationId)}
                              >
                                {thread.workerName} | {appState}
                              </button>
                            )
                          })}
                        </div>

                        <div className="chat-messages">
                          {(activeEmployerChatThread?.messages ?? []).map((message) => (
                            <div
                              key={message.id}
                              className={`chat-message ${message.from === 'employer' ? 'mine' : 'theirs'}`}
                            >
                              {message.text}
                            </div>
                          ))}
                        </div>

                        <div className="chat-input-row">
                          <input
                            value={employerChatInput}
                            onChange={(event) => setEmployerChatInput(event.target.value)}
                            placeholder="כתבי למועמד..."
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                sendEmployerChatMessage()
                              }
                            }}
                          />
                          <button type="button" className="primary" onClick={sendEmployerChatMessage}>
                            שלח
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                </section>
              )}

              {employerTab === 'events' && (
                <section className="panel employer-grid">
                  <article className="card">
                    <h2>סטטוס אירועים ואיוש</h2>
                    <p>
                      איוש מלא: {employerStaffingRows.filter((row) => row.missing === 0).length} | חסרים עובדים:{' '}
                      {employerStaffingRows.reduce((sum, row) => sum + row.missing, 0)}
                    </p>
                    <div className="list">
                      {employerStaffingRows.length === 0 && <p className="empty">עדיין לא פרסמת משרות.</p>}
                      {employerStaffingRows.map((row) => (
                        <div key={row.job.id} className="list-item">
                          <strong>{row.job.title}</strong>
                          <span>
                            תאריך: {row.job.date} | מאושרים: {row.approved} | חסרים: {row.missing}
                          </span>
                          <label>
                            כמה עובדים דרושים באירוע
                            <input
                              type="number"
                              min={1}
                              max={40}
                              value={row.required}
                              onChange={(event) =>
                                updateRequiredWorkers(row.job.id, Number(event.target.value))
                              }
                            />
                          </label>
                          <small>{row.missing === 0 ? 'מאויש' : `חסרים עוד ${row.missing} עובדים`}</small>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              )}
            </>
          )}
        </section>
      )}

      {view === 'admin' && (
        <section className="panel employer-grid">
          <article className="card">
            <h2>Overview מערכת</h2>
            <p>משתמשים: {adminOverview?.usersCount ?? '-'}</p>
            <p>משרות: {adminOverview?.jobsCount ?? '-'}</p>
            <p>מועמדויות: {adminOverview?.appsCount ?? '-'}</p>
            <p>עובדים לא מאומתים: {adminOverview?.pendingWorkers ?? '-'}</p>
            <p>מעסיקים לא מאומתים: {adminOverview?.pendingEmployers ?? '-'}</p>
            <p>משתמשים מושעים: {adminOverview?.suspendedUsers ?? '-'}</p>
            <button type="button" className="ghost" onClick={() => void refreshAdminOverview()}>
              רענן נתוני אדמין
            </button>
            <button type="button" className="primary" onClick={() => void handleRecalculateSuspensions()}>
              חשב השעיות אוטומטי
            </button>
          </article>

          <article className="card">
            <h2>ניהול משתמשים</h2>
            <div className="list admin-scroll">
              {adminUsers.map((user) => (
                <div key={user.id} className="list-item fit">
                  <div>
                    <strong>
                      #{user.id} | {user.email}
                    </strong>
                    <p>
                      תפקיד: {user.role} | מושעה: {user.isSuspended ? 'כן' : 'לא'}
                    </p>
                    {user.worker && (
                      <small>
                        עובד: {user.worker.fullName} | {user.worker.city} | דירוג {user.worker.rating}
                      </small>
                    )}
                    {user.employer && (
                      <small>
                        מעסיק: {user.employer.displayName} | מאומת: {user.employer.isVerified ? 'כן' : 'לא'}
                      </small>
                    )}
                    {user.suspensionReason && <small>סיבת השעיה: {user.suspensionReason}</small>}
                  </div>
                  <div className="fit-actions">
                    {user.worker && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void handleVerifyWorker(user.id)}
                      >
                        אמת עובד
                      </button>
                    )}
                    {user.employer && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void handleVerifyEmployer(user.id)}
                      >
                        אמת מעסיק
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void handleSuspensionToggle(user)}
                    >
                      {user.isSuspended ? 'בטל השעיה' : 'השעה משתמש'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <h2>דוח אמינות</h2>
            <div className="list admin-scroll">
              {trustRows.map((row) => (
                <div key={`${row.role}-${row.userId}`} className="list-item">
                  <strong>
                    #{row.userId} | {row.email}
                  </strong>
                  <span>
                    סוג: {row.role} | נקודות קנס: {row.totalPenalty} | מושעה:{' '}
                    {row.isSuspended ? 'כן' : 'לא'}
                  </span>
                  {row.suspensionReason && <small>{row.suspensionReason}</small>}
                </div>
              ))}
            </div>
          </article>
        </section>
      )}

      <footer className="footer">
        <span>תשלומים כרגע מחוץ לפלטפורמה</span>
        <span>שרת fallback זמין גם אם מסד הנתונים לא פעיל</span>
      </footer>
    </main>
  )
}

export default App
