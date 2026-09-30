export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

export function formatDate(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Today's date in the shop's local time, as 'YYYY-MM-DD'. */
export function getTodayISO(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Days of stock for display: always a whole number ("8 days"). The precise value stays in the
 * data and in every calculation; only what the user sees is rounded. Under half a day shows as
 * "under 1 day" so a product that still has stock never reads as "0 days".
 */
export function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days <= 0) return '0 days'
  if (days < 0.5) return 'under 1 day'
  const whole = Math.round(days)
  return `${whole} ${whole === 1 ? 'day' : 'days'}`
}

/** Whole days as a number (for text sent to the explanation endpoint), or null. */
export const wholeDays = (days: number | null): number | null => (days === null ? null : Math.round(days))

/** Units sold per day for the inventory table, rounded to a whole number (display only; the calculation is unchanged). */
export const formatVelocity = (perDay: number | null): string => (perDay === null ? '—' : `${Math.round(perDay)}/day`)
