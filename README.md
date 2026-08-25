# Serveit - Supabase Edition

פלטפורמת מרקטפלייס לעבודות מזדמנות בישראל.

## מה יש בשלב הזה

- פרונט React עם ממשקי עובד ומעסיק.
- ארכיטקטורת Serverless מבוססת Vercel + Supabase.
- אימות ישיר עם Supabase Auth.
- CRUD ישיר מול טבלאות Supabase/Postgres מהקליינט.
- מודלים עבור משתמשים, פרופילי עובד/מעסיק, משרות, מועמדויות, תוכניות מנוי ושליחת מסמכים.
- מדיניות ביטולים עם נקודות קנס אמינות.
- דירוגים אחרי עבודה ועדכון ממוצע אמינות עובד.
- מסך אדמין עשיר עם טבלאות משתמשים, דוח אמינות, השעיה ידנית וחישוב השעיות אוטומטי.

## מחסנית טכנולוגית

- Frontend: React + TypeScript + Vite
- Hosting: Vercel
- Backend/Data/Auth: Supabase
- Database: PostgreSQL (via Supabase)
- Auth: Supabase Auth

## הפעלה מקומית

1. התקנת תלויות:

```bash
npm install
```

2. יצירת קובץ סביבה:

```bash
cp .env.example .env
```

3. הגדרת משתני Supabase בתוך `.env`:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

4. הרצת הפרויקט:

```bash
npm run dev
```

## כתובות שירות

- Web: http://localhost:5173

## פקודות שימושיות

- Build: npm run build
- Lint: npm run lint

## מבנה פרויקט

- src/App.tsx - מסכי המוצר הראשיים
- src/api.ts - שכבת נתונים ואימות מול Supabase
- src/lib/supabase.ts - יצירת Supabase Client
- src/types.ts - טיפוסים בצד הפרונט

## הערות פריסה

- יש להגדיר ב-Vercel את `VITE_SUPABASE_URL` ואת `VITE_SUPABASE_ANON_KEY`
- יש להפעיל ב-Supabase Auth ספק Email/Password
- יש לוודא שטבלאות Supabase תואמות לסכמה שבה משתמש `src/api.ts`
