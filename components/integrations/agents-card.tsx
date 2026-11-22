'use client'

import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { ConnectAgentDialog } from './connect-agent-dialog'
import { CopyButton } from './copy-button'
import { cardHeaderRow, cardTitle } from './shared'

/**
 * Where agents connect, and the way to connect one. Shown while the MCP
 * server is on, to accounts that manage tokens: a connected agent is a token
 * in the API tokens list.
 */
export function AgentsCard({
  url,
  disabled,
  onConnected,
}: {
  /** The MCP endpoint clients connect to. */
  url: string
  disabled?: boolean
  /** A token was created for an agent. */
  onConnected: () => void
}) {
  return (
    <ConnectAgentDialog url={url} onCreated={onConnected}>
      <Card className="min-w-0">
        <CardHeader className={cardHeaderRow}>
          <div className="min-w-0 space-y-1.5">
            <h2 className={cardTitle}>Agents</h2>
            <CardDescription>
              Let an AI agent such as Claude Code, Cursor or Codex work with
              your files.
            </CardDescription>
          </div>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="shrink-0 self-start"
              disabled={disabled}
            >
              <Plus />
              Connect an agent
            </Button>
          </DialogTrigger>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="agents-server-url">Server URL</Label>
          <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
            <Input
              id="agents-server-url"
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-xs"
            />
            <CopyButton
              value={url}
              name="server URL"
              label="Copy URL"
              className="shrink-0"
            />
          </div>
          <p className="text-pretty text-xs text-muted-foreground">
            Each agent you connect gets its own token under API tokens. Revoke
            the token to disconnect the agent.
          </p>
        </CardContent>
      </Card>
    </ConnectAgentDialog>
  )
}
