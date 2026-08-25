import { PrismaClient, ApplicationState, ShiftWindow, UserRole, VerificationLevel } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const run = async () => {
  const plans = [
    {
      code: 'starter',
      name: 'Starter',
      monthlyPrice: 50,
      openingsLimit: 5,
      features: ['פרסום משרות בסיסי', 'צפייה בפרופילי עובדים', 'ניהול מסמכים בקישור'],
    },
    {
      code: 'pro',
      name: 'Pro',
      monthlyPrice: 80,
      openingsLimit: 20,
      features: ['הבלטת משרות', 'סינון מתקדם לפי דירוג', 'תבניות מסמכים מהירות'],
    },
    {
      code: 'scale',
      name: 'Scale',
      monthlyPrice: 80,
      openingsLimit: 60,
      features: ['חשבון צוות', 'יצוא דוחות', 'תמיכת עדיפות גבוהה'],
    },
  ]

  for (const plan of plans) {
    await prisma.employerPlan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    })
  }

  const passwordHash = await bcrypt.hash('Serveit123!', 10)

  const workerUser = await prisma.user.upsert({
    where: { email: 'worker@serveit.local' },
    update: {
      passwordHash,
      role: UserRole.WORKER,
    },
    create: {
      email: 'worker@serveit.local',
      passwordHash,
      role: UserRole.WORKER,
    },
  })

  await prisma.workerProfile.upsert({
    where: { userId: workerUser.id },
    update: {
      fullName: 'נועה לוי',
      age: 20,
      city: 'גבעתיים',
      rating: 4.9,
      verificationLevel: VerificationLevel.VERIFIED,
      tags: ['שירותיות', 'עברית/אנגלית', 'ניסיון באירועים'],
    },
    create: {
      userId: workerUser.id,
      fullName: 'נועה לוי',
      age: 20,
      city: 'גבעתיים',
      rating: 4.9,
      verificationLevel: VerificationLevel.VERIFIED,
      tags: ['שירותיות', 'עברית/אנגלית', 'ניסיון באירועים'],
    },
  })

  const starterPlan = await prisma.employerPlan.findUniqueOrThrow({ where: { code: 'pro' } })

  const employerUser = await prisma.user.upsert({
    where: { email: 'employer@serveit.local' },
    update: {
      passwordHash,
      role: UserRole.EMPLOYER,
    },
    create: {
      email: 'employer@serveit.local',
      passwordHash,
      role: UserRole.EMPLOYER,
    },
  })

  await prisma.employerProfile.upsert({
    where: { userId: employerUser.id },
    update: {
      displayName: 'קייטרינג אלון',
      isVerified: true,
      activePlanId: starterPlan.id,
    },
    create: {
      userId: employerUser.id,
      displayName: 'קייטרינג אלון',
      isVerified: true,
      activePlanId: starterPlan.id,
    },
  })

  const job = await prisma.job.upsert({
    where: { id: 1 },
    update: {
      title: 'מגיש/ה לאירוע חתונה',
      category: 'אירועים',
      city: 'תל אביב',
      date: new Date('2026-09-03T18:00:00.000Z'),
      shift: ShiftWindow.EVENING,
      hourlyPay: 75,
      description: 'הגשת אוכל ושתייה באירוע ערב. אנרגיה טובה וחיוך חובה.',
      transportOffered: true,
      transportFrom: 'תחנת סבידור מרכז',
      verifiedEmployer: true,
      employerId: employerUser.id,
    },
    create: {
      id: 1,
      title: 'מגיש/ה לאירוע חתונה',
      category: 'אירועים',
      city: 'תל אביב',
      date: new Date('2026-09-03T18:00:00.000Z'),
      shift: ShiftWindow.EVENING,
      hourlyPay: 75,
      description: 'הגשת אוכל ושתייה באירוע ערב. אנרגיה טובה וחיוך חובה.',
      transportOffered: true,
      transportFrom: 'תחנת סבידור מרכז',
      verifiedEmployer: true,
      employerId: employerUser.id,
    },
  })

  await prisma.application.upsert({
    where: {
      jobId_workerId: {
        jobId: job.id,
        workerId: workerUser.id,
      },
    },
    update: {
      state: ApplicationState.PENDING,
    },
    create: {
      jobId: job.id,
      workerId: workerUser.id,
      state: ApplicationState.PENDING,
    },
  })

  await prisma.user.upsert({
    where: { email: 'admin@serveit.local' },
    update: {
      passwordHash,
      role: UserRole.ADMIN,
    },
    create: {
      email: 'admin@serveit.local',
      passwordHash,
      role: UserRole.ADMIN,
    },
  })
}

run()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
