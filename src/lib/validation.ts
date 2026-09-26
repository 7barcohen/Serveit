// Israeli ID / company number (ח.פ. / עוסק מורשה) check digit, the same rule
// the server enforces in is_valid_israeli_id().
export const isValidIsraeliId = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 9) return false
  const padded = digits.padStart(9, '0')
  const sum = [...padded].reduce((total, digit, index) => {
    const step = Number(digit) * (index % 2 === 0 ? 1 : 2)
    return total + (step > 9 ? step - 9 : step)
  }, 0)
  return sum % 10 === 0
}
