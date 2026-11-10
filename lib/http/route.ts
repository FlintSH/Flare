import { NextResponse } from 'next/server'

import type { ZodError } from 'zod'

import { auditRequest } from '@/lib/audit'
import { type Logger, loggers } from '@/lib/logger'

import { type CorsKind, applyCors } from './cors'
import { AccessError, HttpError, InvalidInput } from './errors'
import { mediaType } from './request'

/** How one family of routes answers errors; the handlers only throw. */
export interface RouteContract {
  /** Error bodies also carry `success: false`, like `apiResponse` bodies. */
  envelope?: 'api'
  /** Sends what a handler returned when it isn't a Response; defaults to plain JSON. */
  respond?: (value: unknown) => Response
  /**
   * Which cross-origin access FLARE_CORS_ORIGINS can grant: `token` (the
   * default) for the methods named tokens may call, `file` for public file
   * content. Routes no named token can call get no CORS headers either way.
   */
  cors?: CorsKind
  /** Sent with every response these routes give, unless a handler set it. */
  headers?: Record<string, string>
  /**
   * Answer an error code outside the HTTP layer raises without being an
   * HttpError, such as a database conflict.
   */
  translate?: (error: unknown) => HttpError | undefined
  /** Word a 400 for request input; defaults to the first issue's message. */
  invalid?: (error: ZodError) => HttpError
  /** The message of the 500 for anything else. The error itself is logged, never sent. */
  failure: { message: string }
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
          // JSON answers are private unless a handler says otherwise. File
          // bytes, which carry Content-Disposition, keep what their route
          // chose, even none: a public JSON file is still a file.
          if (
            !response.headers.has('Cache-Control') &&
            !response.headers.has('Content-Disposition') &&
            mediaType(response) === 'application/json'
          )
            response.headers.set('Cache-Control', 'private, no-store')
          return applyCors(request, response, settings.cors ?? 'token')
        }
      )) as RouteHandler<Context>
  }
}

/**
 * An HttpError is answered as it is, and invalid request input as the family
 * words it. Anything else is logged and answered with a 500; a 5xx HttpError
 * logs what caused it.
 */
export function errorResponse(
  error: unknown,
  contract: RouteContract,
  label = 'Request'
): Response {
  const logger = contract.logger ?? loggers.api
  let answer =
    contract.translate?.(error) ??
    (error instanceof InvalidInput
      ? (contract.invalid?.(error.issues) ?? error)
      : error instanceof HttpError
        ? error
        : undefined)
  if (!answer) {
    logger.error(`${label} failed`, error)
    answer = new HttpError(500, contract.failure.message)
  } else if (answer.status >= 500 && answer.cause !== undefined)
    logger.error(`${label} failed`, answer.cause)
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
