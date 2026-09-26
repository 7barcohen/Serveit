import type { UserRole } from '../types'

type Props = {
  onStart: (role: Exclude<UserRole, 'admin'>) => void
  onLogin: () => void
}

// Pre-registration landing page (spec §1.0). Shown on the first visit only;
// App remembers that it was seen.
export function Landing({ onStart, onLogin }: Props) {
  return (
    <section className="landing">
      <header className="card landing-hero">
        <p className="eyebrow">WorkAway</p>
        <h1>עבודה שמתאימה לך. עובדים שמגיעים.</h1>
        <p className="subtitle">
          שוק עבודה ישראלי לשני הצדדים: משמרות זמניות ומשרות קבועות, התאמה הדדית בהחלקה, צ׳אט מוגן ומדד אמינות
          שמתגמל את מי שמגיע בזמן.
        </p>
        <div className="swipe-actions">
          <button type="button" className="primary" onClick={() => onStart('worker')}>
            אני מחפש/ת עבודה
          </button>
          <button type="button" className="primary" onClick={() => onStart('employer')}>
            אני מעסיק/ה
          </button>
          <button type="button" className="ghost" onClick={onLogin}>
            כבר יש לי חשבון
          </button>
        </div>
      </header>

      <div className="landing-grid">
        <article className="card">
          <h2>לעובדים</h2>
          <ul className="landing-list">
            <li>שימוש חינמי לגמרי</li>
            <li>משמרות, עבודה יומית ופרויקטים לצד משרות מלאות וחלקיות</li>
            <li>פיד שמותאם למיקום, לזמינות ולציפיות השכר שלך</li>
            <li>צ׳אט מוגן: הטלפון והמייל שלך לא נחשפים</li>
            <li>הצעת עבודה רשמית, סנכרון ליומן וניווט למשמרת בלחיצה</li>
          </ul>
        </article>
        <article className="card">
          <h2>למעסיקים</h2>
          <ul className="landing-list">
            <li>חודשיים ראשונים חינם</li>
            <li>מועמדים מסודרים לפי מדד אמינות, מרחק ודירוג</li>
            <li>מכסת עובדים למשמרת ורשימת המתנה שממלאת ביטולים אוטומטית</li>
            <li>טופס 101 דיגיטלי נשלח לבד עם אישור ההצעה</li>
            <li>היסטוריית העסקה וגיוס חוזר של עובדים טובים בלחיצה</li>
          </ul>
        </article>
        <article className="card">
          <h2>איך זה עובד?</h2>
          <ol className="landing-list">
            <li>
              <strong>מחליקים:</strong> ימינה לעניין, שמאלה לדילוג. גם המעסיק מחליק על מועמדים.
            </li>
            <li>
              <strong>Match:</strong> כששני הצדדים אמרו כן, נפתח צ׳אט פנימי.
            </li>
            <li>
              <strong>הצעה:</strong> המעסיק שולח הצעה רשמית, והעובד מאשר.
            </li>
            <li>
              <strong>אמינות:</strong> כל עובד מתחיל עם 100 נקודות, שעולות עם כל משמרת שהושלמה.
            </li>
          </ol>
        </article>
      </div>
    </section>
  )
}
