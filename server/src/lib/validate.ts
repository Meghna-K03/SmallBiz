import { badRequest, validationError } from './errors'

type Body = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validates a :id path parameter. */
export function parseId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw badRequest('Invalid ID format')
  return value
}

/**
 * Small field-by-field validator. Each method reads one field from the body,
 * records an error message if it is invalid, and returns the cleaned value.
 * Call `done()` once at the end to throw all collected errors together.
 */
export class Validator {
  private errors: string[] = []
  private body: Body

  constructor(input: unknown) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw badRequest('Request body must be a JSON object')
    }
    this.body = input as Body
  }

  string(field: string, opts: { optional?: boolean; max?: number } = {}): string {
    const v = this.body[field]
    if (v === undefined || v === null || v === '') {
      if (!opts.optional) this.errors.push(`${field} is required`)
      return ''
    }
    if (typeof v !== 'string' || v.trim() === '') {
      this.errors.push(`${field} must be a non-empty string`)
      return ''
    }
    const trimmed = v.trim()
    if (trimmed.length > (opts.max ?? 200)) {
      this.errors.push(`${field} must be at most ${opts.max ?? 200} characters`)
    }
    return trimmed
  }

  /** Money value: finite number, up to 2 decimals, within DECIMAL(10,2). */
  money(field: string, opts: { positive?: boolean } = {}): number {
    const v = this.body[field]
    if (v === undefined || v === null || v === '') {
      this.errors.push(`${field} is required`)
      return 0
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.errors.push(`${field} must be a number`)
      return 0
    }
    if (opts.positive ? v <= 0 : v < 0) {
      this.errors.push(`${field} must be ${opts.positive ? 'greater than 0' : '0 or more'}`)
    } else if (Math.round(v * 100) / 100 !== v) {
      this.errors.push(`${field} must have at most 2 decimal places`)
    } else if (v >= 100_000_000) {
      this.errors.push(`${field} is too large`)
    }
    return v
  }

  /** Whole-number quantity. */
  integer(field: string, opts: { positive?: boolean } = {}): number {
    const v = this.body[field]
    if (v === undefined || v === null || v === '') {
      this.errors.push(`${field} is required`)
      return 0
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      this.errors.push(`${field} must be a whole number`)
      return 0
    }
    if (opts.positive ? v <= 0 : v < 0) {
      this.errors.push(`${field} must be ${opts.positive ? 'greater than 0' : '0 or more'}`)
    } else if (v > 1_000_000_000) {
      this.errors.push(`${field} is too large`)
    }
    return v
  }

  /** Calendar date as 'YYYY-MM-DD'. Returns a Date at UTC midnight. */
  date(field: string): Date {
    const v = this.body[field]
    const fallback = new Date(0)
    if (v === undefined || v === null || v === '') {
      this.errors.push(`${field} is required`)
      return fallback
    }
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      this.errors.push(`${field} must be a date in YYYY-MM-DD format`)
      return fallback
    }
    const d = new Date(`${v}T00:00:00.000Z`)
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
      this.errors.push(`${field} is not a valid calendar date`)
      return fallback
    }
    return d
  }

  /** Product reference in the body; must look like an id (existence is checked separately). */
  id(field: string): string {
    const v = this.body[field]
    if (v === undefined || v === null || v === '') {
      this.errors.push(`${field} is required`)
      return ''
    }
    if (typeof v !== 'string' || !UUID.test(v)) {
      this.errors.push(`${field} is not a valid ID`)
      return ''
    }
    return v
  }

  done(): void {
    if (this.errors.length > 0) throw validationError(this.errors)
  }
}
