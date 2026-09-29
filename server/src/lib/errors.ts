import type { ErrorRequestHandler, RequestHandler } from 'express'

/** An expected, client-facing failure (bad input, missing record, conflict). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: string[],
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: string[]) =>
  new ApiError(400, 'BAD_REQUEST', message, details)

export const validationError = (details: string[]) =>
  new ApiError(400, 'VALIDATION_ERROR', 'Invalid input', details)

export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found`)

export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message)

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`))
}

// Every error response has the shape { error: { code, message, details? } }.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
    return
  }

  // Malformed JSON body (thrown by express.json()).
  if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } })
    return
  }

  // Prisma known request errors carry a string `code` such as P2003.
  const code = typeof err?.code === 'string' ? err.code : undefined
  if (code === 'P2025') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } })
    return
  }
  if (code === 'P2003') {
    res.status(409).json({
      error: { code: 'CONFLICT', message: 'Operation violates a relationship with other records' },
    })
    return
  }

  // Log only the error name/code: database errors can echo connection details.
  console.error('Unhandled error:', err?.name ?? 'Error', code ?? '')
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server' } })
}
