import type { Prisma } from '@prisma/client'
import type * as z from 'zod'

import type { AgentPrincipal } from './auth'
import type { ToolName } from './catalog'

/** A failure worded for the agent: what went wrong and what to try next. */
export class ToolError extends Error {
  constructor(
    message: string,
    /** `denied` for a refusal the audit log should show as one. */
    readonly outcome: 'failure' | 'denied' = 'failure'
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

/** A text or image block beside a tool's structured answer. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export type ToolAnswer<Structured> = {
  /** The answer as data; also sent as compact JSON text. */
  structured: Structured
  /** Blocks after the JSON text: file contents, an image. */
  blocks?: ContentBlock[]
}

export type ToolContext = {
  principal: AgentPrincipal
  /** The MCP request, for its abort signal and the client's address. */
  request: Request
  /** Flare's public address, without a trailing slash. */
  origin: string
  /** Whether the credential and role allow an effect the tool's row names. */
  allows(effect: string): boolean
  /** Refuse the call, saying what is missing, unless the effect is allowed. */
  requireEffect(effect: string): void
  /**
   * The call's access, asked again in the transaction that saves. Everything
   * above is judged by the credential and the role as the call began, and a
   * call can wait: for a lock, or while it reads a file. So a service that
   * saves for a tool is handed this, and runs it once it holds the role lock
   * and the account's row and before it writes. It refuses unless the
   * credential is still live, the server still on, and the credential and
   * the role still hold what the tool needs and what every effect the call
   * required needs. The credential's row is held from here to the commit,
   * so nothing is saved after its end has committed.
   */
  recheck(tx: Prisma.TransactionClient): Promise<void>
}

export type ToolDefinition<
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodObject = z.ZodObject,
> = {
  /** A row of `TOOL_CATALOG`, which decides who may call the tool. */
  name: ToolName
  /** For the model: what the tool does, when to use it, and its limits. */
  description: string
  input: Input
  output: Output
  /**
   * The answer's blocks are what the caller came for: a file's text, a
   * picture. Clients that are given structured content show the model that
   * and drop the blocks beside it, so such a tool sends its data as the first
   * text block only, and declares no output schema.
   */
  blocksOnly?: boolean
  run(
    args: z.infer<Input>,
    context: ToolContext
  ): Promise<ToolAnswer<z.infer<Output>>>
}

/** Keeps a tool's argument and answer types attached to its schemas. */
export function defineTool<
  Input extends z.ZodObject,
  Output extends z.ZodObject,
>(tool: ToolDefinition<Input, Output>): ToolDefinition<Input, Output> {
  return tool
}
