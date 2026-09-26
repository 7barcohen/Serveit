type Props = {
  label: string
  value: number
  onChange: (value: number) => void
}

export function StarInput({ label, value, onChange }: Props) {
  return (
    <div className="star-input" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <div className="stars">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={`${score} כוכבים`}
            className={score <= value ? 'star on' : 'star'}
            onClick={() => onChange(score)}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  )
}
