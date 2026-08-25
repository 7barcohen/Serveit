import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import {
  ApplicationState,
  CancellationActor,
  ShiftWindow,
  UserRole,
  VerificationLevel,
} from '@prisma/client'
import { z } from 'zod'
import { env } from './lib/env.js'
import { prisma } from './lib/prisma.js'
import { requireAuth } from './middleware/auth.js'

const app = express()

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
)
app.use(cookieParser())
app.use(express.json())

const shiftSchema = z.enum(['morning', 'afternoon', 'evening', 'night'])
const roleSchema = z.enum(['worker', 'employer'])

const shiftIn: Record<string, ShiftWindow> = {
  morning: ShiftWindow.MORNING,
  afternoon: ShiftWindow.AFTERNOON,
  evening: ShiftWindow.EVENING,
  night: ShiftWindow.NIGHT,
}

const shiftOut: Record<ShiftWindow, 'morning' | 'afternoon' | 'evening' | 'night'> = {
  MORNING: 'morning',
  AFTERNOON: 'afternoon',
  EVENING: 'evening',
  NIGHT: 'night',
}

const stateOut: Record<ApplicationState, 'pending' | 'approved' | 'rejected'> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
}

const stateIn: Record<string, ApplicationState> = {
  pending: ApplicationState.PENDING,
  approved: ApplicationState.APPROVED,
  rejected: ApplicationState.REJECTED,
}

const roleIn: Record<string, UserRole> = {
  worker: UserRole.WORKER,
  employer: UserRole.EMPLOYER,
}

type FallbackUser = {
  id: number
  email: string
  passwordHash: string
  role: UserRole
  isSuspended: boolean
  fullName?: string
  displayName?: string
  city?: string
  age?: number
}

const fallbackUsers: FallbackUser[] = []
let fallbackUserId = 1000

const fallbackSessions = new Map<string, { userId: number; expiresAt: Date; revokedAt: Date | null }>()

const isDbUnavailable = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  return message.includes("Can't reach database server") || message.includes('PrismaClientInitializationError')
}

const actorFromRole = (role: UserRole): CancellationActor => {
  if (role === UserRole.WORKER) {
    return CancellationActor.WORKER
  }
  if (role === UserRole.EMPLOYER) {
    return CancellationActor.EMPLOYER
  }
  return CancellationActor.ADMIN
}

const createTokenHash = (token: string) => {
  return crypto.createHash('sha256').update(token).digest('hex')
}

const issueAccessToken = (payload: { sub: number; role: UserRole; email: string }) => {
  const options: SignOptions = { expiresIn: env.jwtAccessTtl as SignOptions['expiresIn'] }
  return jwt.sign(payload, env.jwtSecret, options)
}

const issueRefreshToken = () => {
  return crypto.randomBytes(48).toString('hex')
}

const applyAuthCookies = (res: express.Response, accessToken: string, refreshToken: string) => {
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 15,
  })

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * env.refreshTokenTtlDays,
  })
}

const clearAuthCookies = (res: express.Response) => {
  res.clearCookie('access_token')
  res.clearCookie('refresh_token')
}

const ensureFallbackUsers = async () => {
  if (fallbackUsers.length > 0) {
    return
  }

  const passwordHash = await bcrypt.hash('Serveit123!', 10)
  fallbackUsers.push(
    {
      id: 1,
      email: 'worker@serveit.local',
      passwordHash,
      role: UserRole.WORKER,
      isSuspended: false,
      fullName: 'נועה לוי',
      city: 'תל אביב',
      age: 20,
    },
    {
      id: 2,
      email: 'employer@serveit.local',
      passwordHash,
      role: UserRole.EMPLOYER,
      isSuspended: false,
      displayName: 'קייטרינג אלון',
    },
    {
      id: 3,
      email: 'admin@serveit.local',
      passwordHash,
      role: UserRole.ADMIN,
      isSuspended: false,
    },
  )
}

const persistRefreshSession = async (userId: number, refreshToken: string) => {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * env.refreshTokenTtlDays)
  const tokenHash = createTokenHash(refreshToken)
  try {
    await prisma.refreshSession.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    })
  } catch (error) {
    if (!isDbUnavailable(error)) {
      throw error
    }
    fallbackSessions.set(tokenHash, { userId, expiresAt, revokedAt: null })
  }
}

const revokeRefreshSession = async (refreshToken: string) => {
  const tokenHash = createTokenHash(refreshToken)
  try {
    await prisma.refreshSession.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    })
  } catch (error) {
    if (!isDbUnavailable(error)) {
      throw error
    }
    const session = fallbackSessions.get(tokenHash)
    if (session) {
      session.revokedAt = new Date()
      fallbackSessions.set(tokenHash, session)
    }
  }
}

const evaluateSuspension = async (userId: number, role: UserRole) => {
  if (role === UserRole.WORKER) {
    const workerPenalty = await prisma.application.aggregate({
      where: {
        workerId: userId,
        canceledBy: CancellationActor.WORKER,
      },
      _sum: {
        penaltyPoints: true,
      },
    })

    const total = workerPenalty._sum.penaltyPoints ?? 0
    const shouldSuspend = total >= 20

    await prisma.user.update({
      where: { id: userId },
      data: shouldSuspend
        ? {
            isSuspended: true,
            suspendedAt: new Date(),
            suspensionReason: `Auto suspension: worker penalties=${total}`,
          }
        : {
            isSuspended: false,
            suspendedAt: null,
            suspensionReason: null,
          },
    })

    return
  }

  if (role === UserRole.EMPLOYER) {
    const employerPenalty = await prisma.application.aggregate({
      where: {
        canceledBy: CancellationActor.EMPLOYER,
        job: {
          employerId: userId,
        },
      },
      _sum: {
        penaltyPoints: true,
      },
    })

    const total = employerPenalty._sum.penaltyPoints ?? 0
    const shouldSuspend = total >= 12

    await prisma.user.update({
      where: { id: userId },
      data: shouldSuspend
        ? {
            isSuspended: true,
            suspendedAt: new Date(),
            suspensionReason: `Auto suspension: employer penalties=${total}`,
          }
        : {
            isSuspended: false,
            suspendedAt: null,
            suspensionReason: null,
          },
    })
  }
}

const mapApp = (application: {
  id: number
  jobId: number
  workerId: number
  state: ApplicationState
  canceledAt: Date | null
  cancellationReason: string | null
  canceledBy: CancellationActor | null
  penaltyPoints: number
}) => ({
  id: application.id,
  jobId: application.jobId,
  workerId: application.workerId,
  state: stateOut[application.state],
  canceledAt: application.canceledAt?.toISOString() ?? null,
  cancellationReason: application.cancellationReason,
  canceledBy: application.canceledBy?.toLowerCase() ?? null,
  penaltyPoints: application.penaltyPoints,
})

const mapJob = (job: {
  id: number
  title: string
  category: string
  city: string
  date: Date
  shift: ShiftWindow
  hourlyPay: number
  description: string
  transportOffered: boolean
  transportFrom: string | null
  verifiedEmployer: boolean
  employer: {
    email: string
    employerProfile: {
      displayName: string
    } | null
  }
}) => ({
  id: job.id,
  title: job.title,
  category: job.category,
  city: job.city,
  date: job.date.toISOString().slice(0, 10),
  shift: shiftOut[job.shift],
  hourlyPay: job.hourlyPay,
  description: job.description,
  employerName: job.employer.employerProfile?.displayName ?? job.employer.email,
  transportOffered: job.transportOffered,
  transportFrom: job.transportFrom ?? undefined,
  verifiedEmployer: job.verifiedEmployer,
})

const createJobSchema = z.object({
  title: z.string().min(2),
  category: z.string().min(2),
  city: z.string().min(2),
  date: z.string().min(8),
  shift: shiftSchema,
  hourlyPay: z.number().int().min(35),
  transportOffered: z.boolean(),
  transportFrom: z.string().optional(),
})

const createApplicationSchema = z.object({
  jobId: z.number().int(),
  workerId: z.number().int(),
})

const updateApplicationSchema = z.object({
  state: z.enum(['pending', 'approved', 'rejected']),
})

const sendDocumentsSchema = z.object({
  jobId: z.number().int(),
  documentUrl: z.string().url(),
})

const cancelApplicationSchema = z.object({
  reason: z.string().min(2),
})

const reviewSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(280).optional(),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: roleSchema,
  fullName: z.string().min(2).optional(),
  city: z.string().min(2).optional(),
  age: z.number().int().min(16).max(70).optional(),
  displayName: z.string().min(2).optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const verifyWorkerSchema = z.object({
  level: z.enum(['basic', 'verified']),
})

const verifyEmployerSchema = z.object({
  verified: z.boolean(),
})

const suspendUserSchema = z.object({
  isSuspended: z.boolean(),
  reason: z.string().optional(),
})

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true, service: 'serveit-api', db: 'up' })
  } catch {
    res.status(500).json({ ok: false, db: 'down' })
  }
})

app.get('/api/bootstrap', async (_req, res) => {
  try {
    const [jobs, workers, applications, plans, firstWorker] = await Promise.all([
      prisma.job.findMany({
        include: {
          employer: {
            include: {
              employerProfile: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.workerProfile.findMany({ include: { user: true } }),
      prisma.application.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.employerPlan.findMany({ orderBy: { monthlyPrice: 'asc' } }),
      prisma.workerProfile.findFirst({ include: { user: true }, orderBy: { id: 'asc' } }),
    ])

    res.json({
      jobs: jobs.map((job) => mapJob(job)),
      workers: workers.map((worker) => ({
        id: worker.userId,
        fullName: worker.fullName,
        age: worker.age,
        city: worker.city,
        rating: Number(worker.rating),
        verificationLevel:
          worker.verificationLevel === VerificationLevel.VERIFIED ? 'verified' : 'basic',
        tags: worker.tags,
        isSuspended: worker.user.isSuspended,
      })),
      applications: applications.map((application) => mapApp(application)),
      plans: plans.map((plan) => ({
        id: plan.code,
        name: plan.name,
        monthlyPrice: plan.monthlyPrice,
        openingsLimit: plan.openingsLimit,
        features: plan.features,
      })),
      currentWorkerId: firstWorker?.userId ?? null,
    })
  } catch (error) {
    if (!isDbUnavailable(error)) {
      throw error
    }

    await ensureFallbackUsers()

    res.json({
      jobs: [
        {
          id: 1,
          title: 'מגיש/ה לאירוע ערב',
          category: 'אירועים',
          city: 'תל אביב',
          date: '2026-09-10',
          shift: 'evening',
          hourlyPay: 72,
          description: 'הגשת אוכל ושתייה באירוע פרטי.',
          employerName: 'קייטרינג אלון',
          transportOffered: true,
          transportFrom: 'סבידור מרכז',
          verifiedEmployer: true,
        },
      ],
      workers: fallbackUsers
        .filter((user) => user.role === UserRole.WORKER)
        .map((user) => ({
          id: user.id,
          fullName: user.fullName ?? 'עובד חדש',
          age: user.age ?? 20,
          city: user.city ?? 'תל אביב',
          rating: 4.5,
          verificationLevel: 'basic',
          tags: ['חדש במערכת'],
          isSuspended: user.isSuspended,
        })),
      applications: [],
      plans: [
        { id: 'starter', name: 'Starter', monthlyPrice: 50, openingsLimit: 5, features: ['פרסום משרות'] },
        { id: 'pro', name: 'Pro', monthlyPrice: 80, openingsLimit: 20, features: ['סינון מתקדם'] },
      ],
      currentWorkerId: fallbackUsers.find((user) => user.role === UserRole.WORKER)?.id ?? null,
      degradedMode: true,
    })
  }
})

app.get('/api/auth/me', requireAuth(), async (req, res) => {
  if (!req.auth) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const auth = req.auth

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.sub },
      include: {
        workerProfile: true,
        employerProfile: true,
      },
    })

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({
      id: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      fullName: user.workerProfile?.fullName ?? null,
      displayName: user.employerProfile?.displayName ?? null,
      isSuspended: user.isSuspended,
    })
  } catch (error) {
    if (!isDbUnavailable(error)) {
      throw error
    }

    await ensureFallbackUsers()
    const user = fallbackUsers.find((entry) => entry.id === auth.sub)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({
      id: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      fullName: user.fullName ?? null,
      displayName: user.displayName ?? null,
      isSuspended: user.isSuspended,
    })
  }
})

app.post('/api/auth/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token as string | undefined
  if (!refreshToken) {
    res.status(401).json({ error: 'Missing refresh token' })
    return
  }

  try {
    const tokenHash = createTokenHash(refreshToken)
    const session = await prisma.refreshSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: { user: true },
    })

    if (!session) {
      clearAuthCookies(res)
      res.status(401).json({ error: 'Refresh session not found' })
      return
    }

    if (session.user.isSuspended) {
      clearAuthCookies(res)
      res.status(423).json({ error: 'Account suspended' })
      return
    }

    await revokeRefreshSession(refreshToken)

    const nextAccessToken = issueAccessToken({
      sub: session.user.id,
      role: session.user.role,
      email: session.user.email,
    })
    const nextRefreshToken = issueRefreshToken()
    await persistRefreshSession(session.user.id, nextRefreshToken)
    applyAuthCookies(res, nextAccessToken, nextRefreshToken)

    res.json({ ok: true, role: session.user.role.toLowerCase(), userId: session.user.id })
  } catch (error) {
    if (!isDbUnavailable(error)) {
      throw error
    }

    await ensureFallbackUsers()

    const session = fallbackSessions.get(createTokenHash(refreshToken))
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      clearAuthCookies(res)
      res.status(401).json({ error: 'Refresh session not found' })
      return
    }

    const user = fallbackUsers.find((entry) => entry.id === session.userId)
    if (!user || user.isSuspended) {
      clearAuthCookies(res)
      res.status(423).json({ error: 'Account suspended' })
      return
    }

    await revokeRefreshSession(refreshToken)
    const nextAccessToken = issueAccessToken({ sub: user.id, role: user.role, email: user.email })
    const nextRefreshToken = issueRefreshToken()
    await persistRefreshSession(user.id, nextRefreshToken)
    applyAuthCookies(res, nextAccessToken, nextRefreshToken)

    res.json({ ok: true, role: user.role.toLowerCase(), userId: user.id })
  }
})

app.post('/api/auth/logout', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token as string | undefined
  if (refreshToken) {
    await revokeRefreshSession(refreshToken)
  }
  clearAuthCookies(res)
  res.json({ ok: true })
})

app.post('/api/jobs', requireAuth([UserRole.EMPLOYER, UserRole.ADMIN]), async (req, res) => {
  const parse = createJobSchema.safeParse(req.body)
  if (!parse.success || !req.auth) {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { userId: req.auth.sub },
    include: { activePlan: true },
  })
  if (!employerProfile && req.auth.role !== UserRole.ADMIN) {
    res.status(403).json({ error: 'Employer profile missing' })
    return
  }

  if (employerProfile?.activePlan) {
    const jobsCount = await prisma.job.count({ where: { employerId: req.auth.sub } })
    if (jobsCount >= employerProfile.activePlan.openingsLimit) {
      res.status(403).json({ error: 'Plan limit reached' })
      return
    }
  }

  const input = parse.data
  const created = await prisma.job.create({
    data: {
      title: input.title,
      category: input.category,
      city: input.city,
      date: new Date(input.date),
      shift: shiftIn[input.shift],
      hourlyPay: input.hourlyPay,
      description: 'משרה חדשה שנוצרה על ידי המעסיק דרך המערכת.',
      transportOffered: input.transportOffered,
      transportFrom: input.transportFrom,
      verifiedEmployer: employerProfile?.isVerified ?? true,
      employerId: req.auth.sub,
    },
    include: {
      employer: {
        include: { employerProfile: true },
      },
    },
  })

  res.status(201).json(mapJob(created))
})

app.post('/api/applications', requireAuth([UserRole.WORKER, UserRole.ADMIN]), async (req, res) => {
  const parse = createApplicationSchema.safeParse(req.body)
  if (!parse.success || !req.auth) {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }

  const { jobId, workerId } = parse.data
  if (req.auth.role === UserRole.WORKER && req.auth.sub !== workerId) {
    res.status(403).json({ error: 'Worker can apply only for self' })
    return
  }

  const [job, worker] = await Promise.all([
    prisma.job.findUnique({ where: { id: jobId } }),
    prisma.workerProfile.findUnique({ where: { userId: workerId }, include: { user: true } }),
  ])
  if (!job || !worker) {
    res.status(404).json({ error: 'Job or worker not found' })
    return
  }

  if (worker.user.isSuspended) {
    res.status(423).json({ error: 'Worker account suspended' })
    return
  }

  const existing = await prisma.application.findUnique({
    where: {
      jobId_workerId: { jobId, workerId },
    },
  })
  if (existing) {
    res.json(mapApp(existing))
    return
  }

  const autoApproved = job.hourlyPay >= 60 && job.verifiedEmployer
  const created = await prisma.application.create({
    data: {
      jobId,
      workerId,
      state: autoApproved ? ApplicationState.APPROVED : ApplicationState.PENDING,
    },
  })

  res.status(201).json(mapApp(created))
})

app.patch(
  '/api/applications/:id',
  requireAuth([UserRole.EMPLOYER, UserRole.ADMIN]),
  async (req, res) => {
    const id = Number(req.params.id)
    const parse = updateApplicationSchema.safeParse(req.body)
    if (!parse.success || Number.isNaN(id) || !req.auth) {
      res.status(400).json({ error: 'Invalid payload' })
      return
    }

    const target = await prisma.application.findUnique({
      where: { id },
      include: { job: true },
    })
    if (!target) {
      res.status(404).json({ error: 'Application not found' })
      return
    }

    if (req.auth.role === UserRole.EMPLOYER && target.job.employerId !== req.auth.sub) {
      res.status(403).json({ error: 'Not your job application' })
      return
    }

    const updated = await prisma.application.update({
      where: { id },
      data: {
        state: stateIn[parse.data.state],
      },
    })

    res.json(mapApp(updated))
  },
)

app.post('/api/applications/:id/cancel', requireAuth(), async (req, res) => {
  const id = Number(req.params.id)
  const parse = cancelApplicationSchema.safeParse(req.body)
  if (!parse.success || Number.isNaN(id) || !req.auth) {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }

  const target = await prisma.application.findUnique({
    where: { id },
    include: { job: true },
  })

  if (!target) {
    res.status(404).json({ error: 'Application not found' })
    return
  }

  const isWorkerOwner = req.auth.role === UserRole.WORKER && target.workerId === req.auth.sub
  const isEmployerOwner = req.auth.role === UserRole.EMPLOYER && target.job.employerId === req.auth.sub
  const isAdmin = req.auth.role === UserRole.ADMIN

  if (!isWorkerOwner && !isEmployerOwner && !isAdmin) {
    res.status(403).json({ error: 'Not allowed to cancel this application' })
    return
  }

  const hoursUntilShift = (target.job.date.getTime() - Date.now()) / (1000 * 60 * 60)
  const penaltyPoints =
    hoursUntilShift < 12 ? (req.auth.role === UserRole.WORKER ? 10 : req.auth.role === UserRole.EMPLOYER ? 4 : 0) : 0

  const updated = await prisma.application.update({
    where: { id },
    data: {
      state: ApplicationState.REJECTED,
      canceledAt: new Date(),
      canceledBy: actorFromRole(req.auth.role),
      cancellationReason: parse.data.reason,
      penaltyPoints,
    },
  })

  if (req.auth.role === UserRole.WORKER || req.auth.role === UserRole.EMPLOYER) {
    await evaluateSuspension(req.auth.sub, req.auth.role)
  }

  res.json({
    ...mapApp(updated),
    policy: penaltyPoints > 0 ? 'ביטול מאוחר: נקודות אמינות הופחתו' : 'ביטול תקין ללא קנס',
  })
})

app.post('/api/applications/:id/reviews', requireAuth(), async (req, res) => {
  const id = Number(req.params.id)
  const parse = reviewSchema.safeParse(req.body)
  if (!parse.success || Number.isNaN(id) || !req.auth) {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }

  const target = await prisma.application.findUnique({
    where: { id },
    include: { job: true },
  })

  if (!target) {
    res.status(404).json({ error: 'Application not found' })
    return
  }

  const isWorkerOwner = target.workerId === req.auth.sub
  const isEmployerOwner = target.job.employerId === req.auth.sub
  const isAdmin = req.auth.role === UserRole.ADMIN

  if (!isWorkerOwner && !isEmployerOwner && !isAdmin) {
    res.status(403).json({ error: 'Not allowed to review this application' })
    return
  }

  if (target.state !== ApplicationState.APPROVED) {
    res.status(400).json({ error: 'Only approved matches can be reviewed' })
    return
  }

  const review = await prisma.applicationReview.upsert({
    where: {
      applicationId_reviewerId: {
        applicationId: target.id,
        reviewerId: req.auth.sub,
      },
    },
    update: {
      score: parse.data.score,
      comment: parse.data.comment,
    },
    create: {
      applicationId: target.id,
      reviewerId: req.auth.sub,
      score: parse.data.score,
      comment: parse.data.comment,
    },
  })

  if (!isWorkerOwner) {
    const aggregate = await prisma.applicationReview.aggregate({
      where: {
        application: {
          workerId: target.workerId,
        },
      },
      _avg: { score: true },
    })

    await prisma.workerProfile.update({
      where: { userId: target.workerId },
      data: {
        rating: aggregate._avg.score ?? 0,
      },
    })
  }

  res.json({
    id: review.id,
    applicationId: review.applicationId,
    score: review.score,
    comment: review.comment,
  })
})

app.post(
  '/api/documents/send',
  requireAuth([UserRole.EMPLOYER, UserRole.ADMIN]),
  async (req, res) => {
    const parse = sendDocumentsSchema.safeParse(req.body)
    if (!parse.success || !req.auth) {
      res.status(400).json({ error: 'Invalid payload' })
      return
    }

    const { jobId, documentUrl } = parse.data
    const job = await prisma.job.findUnique({ where: { id: jobId } })
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }

    if (req.auth.role === UserRole.EMPLOYER && job.employerId !== req.auth.sub) {
      res.status(403).json({ error: 'Not your job' })
      return
    }

    const approved = await prisma.application.findMany({
      where: { jobId, state: ApplicationState.APPROVED },
    })

    if (approved.length === 0) {
      res.status(400).json({ error: 'Documents can be sent only after approved matches exist' })
      return
    }

    await prisma.documentDispatch.create({
      data: {
        jobId,
        documentUrl,
        recipients: approved.map((entry) => entry.workerId),
      },
    })

    res.json({
      ok: true,
      sentToWorkers: approved.map((entry) => entry.workerId),
      message: `קישור נשלח ל-${approved.length} עובדים`,
      documentUrl,
    })
  },
)

app.get('/api/admin/overview', requireAuth([UserRole.ADMIN]), async (_req, res) => {
  const [usersCount, jobsCount, appsCount, pendingWorkers, pendingEmployers, suspendedUsers] =
    await Promise.all([
      prisma.user.count(),
      prisma.job.count(),
      prisma.application.count(),
      prisma.workerProfile.count({ where: { verificationLevel: VerificationLevel.BASIC } }),
      prisma.employerProfile.count({ where: { isVerified: false } }),
      prisma.user.count({ where: { isSuspended: true } }),
    ])

  res.json({
    usersCount,
    jobsCount,
    appsCount,
    pendingWorkers,
    pendingEmployers,
    suspendedUsers,
  })
})

app.get('/api/admin/users', requireAuth([UserRole.ADMIN]), async (req, res) => {
  const role = typeof req.query.role === 'string' ? req.query.role.toUpperCase() : undefined
  const where = role && ['WORKER', 'EMPLOYER', 'ADMIN'].includes(role) ? { role: role as UserRole } : {}

  const users = await prisma.user.findMany({
    where,
    include: {
      workerProfile: true,
      employerProfile: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  res.json(
    users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      isSuspended: user.isSuspended,
      suspensionReason: user.suspensionReason,
      createdAt: user.createdAt.toISOString(),
      worker: user.workerProfile
        ? {
            fullName: user.workerProfile.fullName,
            city: user.workerProfile.city,
            rating: Number(user.workerProfile.rating),
            verificationLevel:
              user.workerProfile.verificationLevel === VerificationLevel.VERIFIED
                ? 'verified'
                : 'basic',
          }
        : null,
      employer: user.employerProfile
        ? {
            displayName: user.employerProfile.displayName,
            isVerified: user.employerProfile.isVerified,
          }
        : null,
    })),
  )
})

app.get('/api/admin/trust-report', requireAuth([UserRole.ADMIN]), async (_req, res) => {
  const [workers, employers] = await Promise.all([
    prisma.user.findMany({
      where: { role: UserRole.WORKER },
      include: {
        workerProfile: true,
        applications: true,
      },
    }),
    prisma.user.findMany({
      where: { role: UserRole.EMPLOYER },
      include: {
        jobs: {
          include: {
            applications: true,
          },
        },
      },
    }),
  ])

  const workerRows = workers.map((user) => {
    const penalty = user.applications
      .filter((appEntry) => appEntry.canceledBy === CancellationActor.WORKER)
      .reduce((acc, appEntry) => acc + appEntry.penaltyPoints, 0)

    return {
      userId: user.id,
      email: user.email,
      role: 'worker',
      totalPenalty: penalty,
      isSuspended: user.isSuspended,
      suspensionReason: user.suspensionReason,
    }
  })

  const employerRows = employers.map((user) => {
    const penalty = user.jobs
      .flatMap((job) => job.applications)
      .filter((appEntry) => appEntry.canceledBy === CancellationActor.EMPLOYER)
      .reduce((acc, appEntry) => acc + appEntry.penaltyPoints, 0)

    return {
      userId: user.id,
      email: user.email,
      role: 'employer',
      totalPenalty: penalty,
      isSuspended: user.isSuspended,
      suspensionReason: user.suspensionReason,
    }
  })

  res.json({ rows: [...workerRows, ...employerRows].sort((a, b) => b.totalPenalty - a.totalPenalty) })
})

app.post('/api/admin/suspensions/recalculate', requireAuth([UserRole.ADMIN]), async (_req, res) => {
  const [workers, employers] = await Promise.all([
    prisma.user.findMany({ where: { role: UserRole.WORKER }, select: { id: true } }),
    prisma.user.findMany({ where: { role: UserRole.EMPLOYER }, select: { id: true } }),
  ])

  for (const worker of workers) {
    await evaluateSuspension(worker.id, UserRole.WORKER)
  }

  for (const employer of employers) {
    await evaluateSuspension(employer.id, UserRole.EMPLOYER)
  }

  res.json({ ok: true, workers: workers.length, employers: employers.length })
})

app.patch('/api/admin/users/:id/suspension', requireAuth([UserRole.ADMIN]), async (req, res) => {
  const id = Number(req.params.id)
  const parse = suspendUserSchema.safeParse(req.body)
  if (Number.isNaN(id) || !parse.success) {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      isSuspended: parse.data.isSuspended,
      suspendedAt: parse.data.isSuspended ? new Date() : null,
      suspensionReason: parse.data.isSuspended ? parse.data.reason ?? 'Manual suspension by admin' : null,
    },
  })

  res.json({ id: updated.id, isSuspended: updated.isSuspended, suspensionReason: updated.suspensionReason })
})

app.patch('/api/admin/workers/:userId/verify', requireAuth([UserRole.ADMIN]), async (req, res) => {
  const userId = Number(req.params.userId)
  const parse = verifyWorkerSchema.safeParse(req.body)
  if (Number.isNaN(userId) || !parse.success) {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }

  const updated = await prisma.workerProfile.update({
    where: { userId },
    data: {
      verificationLevel:
        parse.data.level === 'verified' ? VerificationLevel.VERIFIED : VerificationLevel.BASIC,
    },
  })

  res.json({
    userId: updated.userId,
    verificationLevel:
      updated.verificationLevel === VerificationLevel.VERIFIED ? 'verified' : 'basic',
  })
})

app.patch(
  '/api/admin/employers/:userId/verify',
  requireAuth([UserRole.ADMIN]),
  async (req, res) => {
    const userId = Number(req.params.userId)
    const parse = verifyEmployerSchema.safeParse(req.body)
    if (Number.isNaN(userId) || !parse.success) {
      res.status(400).json({ error: 'Invalid payload' })
      return
    }

    const updated = await prisma.employerProfile.update({
      where: { userId },
      data: {
        isVerified: parse.data.verified,
      },
    })

    res.json({ userId: updated.userId, isVerified: updated.isVerified })
  },
)

app.post('/api/auth/register', async (req, res) => {
  const parse = registerSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid payload', details: parse.error.flatten() })
    return
  }

  const input = parse.data

  try {
    const existing = await prisma.user.findUnique({ where: { email: input.email } })
    if (existing) {
      res.status(409).json({ error: 'Email already in use' })
      return
    }

    const passwordHash = await bcrypt.hash(input.password, 10)
    const role = roleIn[input.role]

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        role,
      },
    })

    if (role === UserRole.WORKER) {
      await prisma.workerProfile.create({
        data: {
          userId: user.id,
          fullName: input.fullName ?? 'עובד חדש',
          age: input.age ?? 20,
          city: input.city ?? 'תל אביב',
          rating: 0,
          verificationLevel: VerificationLevel.BASIC,
          tags: ['חדש במערכת'],
        },
      })
    }

    if (role === UserRole.EMPLOYER) {
      const defaultPlan = await prisma.employerPlan.findFirst({ orderBy: { monthlyPrice: 'asc' } })
      await prisma.employerProfile.create({
        data: {
          userId: user.id,
          displayName: input.displayName ?? 'מעסיק חדש',
          isVerified: false,
          activePlanId: defaultPlan?.id,
        },
      })
    }

    const accessToken = issueAccessToken({ sub: user.id, role: user.role, email: user.email })
    const refreshToken = issueRefreshToken()
    await persistRefreshSession(user.id, refreshToken)
    applyAuthCookies(res, accessToken, refreshToken)

    res.status(201).json({ role: user.role.toLowerCase(), userId: user.id })
  } catch (error) {
    if (!isDbUnavailable(error)) {
      throw error
    }

    await ensureFallbackUsers()
    const exists = fallbackUsers.some((entry) => entry.email.toLowerCase() === input.email.toLowerCase())
    if (exists) {
      res.status(409).json({ error: 'Email already in use' })
      return
    }

    const passwordHash = await bcrypt.hash(input.password, 10)
    const role = roleIn[input.role]
    const user: FallbackUser = {
      id: fallbackUserId,
      email: input.email,
      passwordHash,
      role,
      isSuspended: false,
      fullName: role === UserRole.WORKER ? input.fullName ?? 'עובד חדש' : undefined,
      displayName: role === UserRole.EMPLOYER ? input.displayName ?? 'מעסיק חדש' : undefined,
      city: role === UserRole.WORKER ? input.city ?? 'תל אביב' : undefined,
      age: role === UserRole.WORKER ? input.age ?? 20 : undefined,
    }
    fallbackUserId += 1
    fallbackUsers.push(user)

    const accessToken = issueAccessToken({ sub: user.id, role: user.role, email: user.email })
    const refreshToken = issueRefreshToken()
    await persistRefreshSession(user.id, refreshToken)
    applyAuthCookies(res, accessToken, refreshToken)

    res.status(201).json({ role: user.role.toLowerCase(), userId: user.id })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }

  const { email, password } = parse.data

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    if (user.isSuspended) {
      res.status(423).json({ error: 'Account suspended' })
      return
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const accessToken = issueAccessToken({ sub: user.id, role: user.role, email: user.email })
    const refreshToken = issueRefreshToken()
    await persistRefreshSession(user.id, refreshToken)
    applyAuthCookies(res, accessToken, refreshToken)

    res.json({ role: user.role.toLowerCase(), userId: user.id })
  } catch (error) {
    if (!isDbUnavailable(error)) {
      throw error
    }

    await ensureFallbackUsers()
    const user = fallbackUsers.find((entry) => entry.email.toLowerCase() === email.toLowerCase())
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    if (user.isSuspended) {
      res.status(423).json({ error: 'Account suspended' })
      return
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const accessToken = issueAccessToken({ sub: user.id, role: user.role, email: user.email })
    const refreshToken = issueRefreshToken()
    await persistRefreshSession(user.id, refreshToken)
    applyAuthCookies(res, accessToken, refreshToken)

    res.json({ role: user.role.toLowerCase(), userId: user.id })
  }
})

app.post('/api/auth/mock-login', async (req, res) => {
  const schema = z.object({ role: roleSchema })
  const parse = schema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid role' })
    return
  }

  const role = roleIn[parse.data.role]

  try {
    const user = await prisma.user.findFirst({ where: { role }, orderBy: { id: 'asc' } })
    if (!user) {
      res.status(404).json({ error: 'No user for role found' })
      return
    }

    const accessToken = issueAccessToken({ sub: user.id, role: user.role, email: user.email })
    const refreshToken = issueRefreshToken()
    await persistRefreshSession(user.id, refreshToken)
    applyAuthCookies(res, accessToken, refreshToken)

    res.json({ role: parse.data.role, userId: user.id })
  } catch (error) {
    if (!isDbUnavailable(error)) {
      throw error
    }

    await ensureFallbackUsers()
    const user = fallbackUsers.find((entry) => entry.role === role)
    if (!user) {
      res.status(404).json({ error: 'No user for role found' })
      return
    }

    const accessToken = issueAccessToken({ sub: user.id, role: user.role, email: user.email })
    const refreshToken = issueRefreshToken()
    await persistRefreshSession(user.id, refreshToken)
    applyAuthCookies(res, accessToken, refreshToken)

    res.json({ role: parse.data.role, userId: user.id })
  }
})

app.listen(env.port, () => {
  console.log(`Serveit API listening on http://localhost:${env.port}`)
})
