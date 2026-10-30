type Props = {
  label: string
  value: number
  onChange: (value: number) => void
}

export function StarInput({ label, value, onChange }: Props) {
  return (
    <div className="star-input" role="radiogroup" aria-label={label} aria-required="true">
      <span>{label}</span>
      <div className="stars">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            tabIndex={value === score || (!value && score === 1) ? 0 : -1}
            aria-label={`${score} כוכבים`}
            className={score <= value ? 'star on' : 'star'}
            onClick={() => onChange(score)}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowLeft' ? Math.min(5, score + 1)
                : event.key === 'ArrowRight' ? Math.max(1, score - 1)
                  : event.key === 'Home' ? 1
                    : event.key === 'End' ? 5 : null
              if (next === null) return
              event.preventDefault()
              onChange(next)
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next - 1]?.focus()
            }}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  )
}
