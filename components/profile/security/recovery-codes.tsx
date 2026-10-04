'use client'

import { useState } from 'react'

import { Check, Copy, Download, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function RecoveryCodes({
  codes,
  onDone,
  kind = 'authenticator',
}: {
  codes: string[]
  onDone: () => void
  kind?: 'authenticator' | 'passkey'
}) {
  const passkey = kind === 'passkey'
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  function downloadCodes() {
    const text = [
      passkey ? 'Flare passkey recovery codes' : 'Flare recovery codes',
      window.location.origin,
      '',
      passkey
        ? 'Keep these codes private. Each code grants full account access once with your email address alone. No password is required.'
        : 'Keep these codes private. Each code can be used once with your password.',
      'Replacing recovery codes invalidates this list.',
      '',
      ...codes,
    ].join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = passkey
      ? 'flare-passkey-recovery-codes.txt'
      : 'flare-recovery-codes.txt'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <ShieldCheck
          className="mt-0.5 h-5 w-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <p className="text-sm leading-relaxed">
          Store these codes somewhere private, such as your password manager.
          {passkey
            ? ' Each passkey recovery code grants full account access once with your email address alone, without a password. Keep them separate from your passkey device. These are different from authenticator recovery codes.'
            : ' Each code replaces your authenticator once when signing in with your password.'}{' '}
          You will not be able to view this list again.
        </p>
      </div>
      <ul
        aria-label={passkey ? 'Passkey recovery codes' : 'Recovery codes'}
        data-sensitive="true"
        className={`grid grid-cols-1 gap-2 rounded-xl border bg-muted/30 p-4 ${passkey ? '' : 'sm:grid-cols-2'}`}
      >
        {codes.map((code) => (
          <li
            key={code}
            className={`break-words text-center font-mono select-all ${passkey ? 'text-xs tracking-tight sm:text-sm' : 'text-sm tracking-wide'}`}
          >
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={copyCodes}>
          {copied ? (
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy codes'}
        </Button>
        <Button type="button" variant="outline" onClick={downloadCodes}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Download
          codes
        </Button>
      </div>
      {copyError && (
        <p role="alert" className="text-sm text-destructive">
          Unable to copy. Download the codes or select and copy them manually.
        </p>
      )}
      <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-1 h-4 w-4 accent-primary"
        />
        I have saved my recovery codes somewhere safe.
      </label>
      <Button
        type="button"
        className="w-full"
        disabled={!saved}
        onClick={onDone}
      >
        Done
      </Button>
    </div>
  )
}
