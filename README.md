# Serveit - Stage 5

פלטפורמת מרקטפלייס לעבודות מזדמנות בישראל.

## מה יש בשלב הזה

- פרונט React עם ממשקי עובד ומעסיק.
- שרת Express עם אימות JWT והרשאות לפי תפקיד.
- אימות מבוסס Cookies עם Access + Refresh ו-rotation.
- בסיס נתונים PostgreSQL עם Prisma ORM.
- מודלים עבור משתמשים, פרופילי עובד/מעסיק, משרות, מועמדויות, תוכניות מנוי ושליחת מסמכים.
- מדיניות ביטולים עם נקודות קנס אמינות.
- דירוגים אחרי עבודה ועדכון ממוצע אמינות עובד.
- מסך אדמין עשיר עם טבלאות משתמשים, דוח אמינות, השעיה ידנית וחישוב השעיות אוטומטי.
- דאטה התחלתי באמצעות seed.

## מחסנית טכנולוגית

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- ORM: Prisma
- Database: PostgreSQL
- Validation: Zod
- Auth: JWT + bcrypt

## הפעלה מקומית

1. התקנת תלויות:

```bash
npm install
```

2. יצירת קובץ סביבה:

```bash
cp .env.example .env
```

3. העלאת PostgreSQL:

```bash
npm run db:up
```

4. יצירת Prisma Client:

```bash
npm run db:generate
```

5. הרצת מיגרציה:

```bash
npm run db:migrate
```

6. זריעת נתונים התחלתיים:

```bash
npm run db:seed
```

7. הרצת הפרויקט (שרת + קליינט):

```bash
npm run dev
```

## כתובות שירות

- Web: http://localhost:5173
- API: http://localhost:4000

## פקודות שימושיות

- Build: npm run build
- Lint: npm run lint
- כיבוי DB: npm run db:down
- איפוס DB: npm run db:reset

## מבנה פרויקט

- src/App.tsx - מסכי המוצר הראשיים
- src/api.ts - לקוח API בצד הפרונט
- src/types.ts - טיפוסים בצד הפרונט
- backend/src/server.ts - נתיבי API ולוגיקה עסקית
- backend/src/middleware/auth.ts - אימות והרשאות
- backend/src/lib/prisma.ts - Prisma Client
- prisma/schema.prisma - סכמת מסד הנתונים
- prisma/seed.ts - דאטה התחלתי
- docker-compose.yml - PostgreSQL מקומי

## נקודות כניסה של API

- GET /api/health
- GET /api/bootstrap
- POST /api/jobs
- POST /api/applications
- PATCH /api/applications/:id
- POST /api/documents/send
- POST /api/applications/:id/cancel
- POST /api/applications/:id/reviews
- POST /api/auth/register
- POST /api/auth/login
- GET /api/auth/me
- POST /api/auth/refresh
- POST /api/auth/logout
- POST /api/auth/mock-login
- GET /api/admin/overview
- GET /api/admin/users
- GET /api/admin/trust-report
- POST /api/admin/suspensions/recalculate
- PATCH /api/admin/users/:id/suspension
- PATCH /api/admin/workers/:userId/verify
- PATCH /api/admin/employers/:userId/verify

## משתמשי דמו אחרי seed

- עובד: worker@serveit.local
- מעסיק: employer@serveit.local
- סיסמה: Serveit123!
