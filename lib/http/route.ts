import { NextResponse } from 'next/server'

import { ZodError } from 'zod'

import { auditRequest } from '@/lib/audit'
import { type Logger, loggers } from '@/lib/logger'

import { AccessError, HttpError } from './errors'

/** How one family of routes answers errors; the handlers only throw. */
export interface RouteContract {
  /** Error bodies also carry `success: false`, like `apiResponse` bodies. */
  envelope?: 'api'
  /** Sends what a handler returned when it isn't a Response; defaults to plain JSON. */
  respond?: (value: unknown) => Response
  /** Sent with every response these routes give, unless a handler set it. */
  headers?: Record<string, string>
  /** Turn an error only this family raises, such as a database conflict, into an answer. */
  translate?: (error: unknown) => HttpError | undefined
  /** Answer a body that failed its schema; defaults to the first issue's message. */
  invalid?: (error: ZodError) => HttpError
  /** Answer anything else. The error itself is logged, never sent. */
  failure: { status?: number; message: string }
  logger?: Logger
  audit?: {
    /** The audit action, when it depends on the request rather than only its method. */
    action?: string | ((request: Request) => string)
    category?: string
    skipSuccess?: boolean
  }
}

type Handler<Context> = (request: Request, context: Context) => Promise<unknown>

/** Routes without parameters can be called without a context, as tests do. */
type RouteHandler<Context> = unknown extends Context
  ? (request: Request, context?: Context) => Promise<Response>
  : (request: Request, context: Context) => Promise<Response>

/**
 * Route handlers for one route template, which the request audit records.
 * Each handler authenticates, checks and answers by returning a response or
 * data, or by throwing; errors become the family's error responses.
 */
export function routes(template: string, contract: RouteContract) {
  return function handler<Context = unknown>(
    handle: Handler<Context>,
    overrides: Partial<RouteContract> = {}
  ): RouteHandler<Context> {
    const settings = { ...contract, ...overrides }
    const { action, ...audit } = settings.audit ?? {}
    return ((request: Request, context: Context) =>
      auditRequest(
        request,
        {
          route: template,
          ...audit,
          action: typeof action === 'function' ? action(request) : action,
        },
        async () => {
          let response: Response
          try {
            const value = await handle(request, context)
            response =
              value instanceof Response
                ? value
                : settings.respond
                  ? settings.respond(value)
                  : NextResponse.json(value)
          } catch (error) {
            response = errorResponse(
              error,
              settings,
              `${request.method} ${template}`
            )
          }
          for (const [name, value] of Object.entries(settings.headers ?? {}))
            if (!response.headers.has(name)) response.headers.set(name, value)
          return response
        }
      )) as RouteHandler<Context>
  }
}

export function errorResponse(
  error: unknown,
  contract: RouteContract,
  label = 'Request'
): Response {
  let answer =
    contract.translate?.(error) ??
    (error instanceof HttpError
      ? error
      : error instanceof ZodError
        ? (contract.invalid?.(error) ??
          new HttpError(400, error.issues[0]?.message ?? 'Invalid request.'))
        : undefined)
  if (!answer) {
    ;(contract.logger ?? loggers.api).error(`${label} failed`, error)
    answer = new HttpError(
      contract.failure.status ?? 500,
      contract.failure.message
    )
  }
  return NextResponse.json(
    {
      ...(contract.envelope === 'api' && !(answer instanceof AccessError)
        ? { success: false }
        : {}),
      error: answer.message,
      ...answer.body,
    },
    { status: answer.status, headers: answer.headers }
  )
}
