'use client'

import { useState } from 'react'

import { AlertCircle, ArrowLeft, Check, Copy, Download } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { saveBlobAsFile } from '@/lib/client/save-file'
import { cn } from '@/lib/utils'

/** How many words the person types back before the phrase counts as saved. */
const CHECKED_WORDS = 3

/** Positions of the phrase to ask for, in ascending order, chosen at random. */
function pickPositions(count: number) {
  const positions = new Set<number>()
  const random = new Uint32Array(1)
  while (positions.size < Math.min(CHECKED_WORDS, count)) {
    crypto.getRandomValues(random)
    positions.add(random[0] % count)
  }
  return [...positions].sort((a, b) => a - b)
}

/** The numbered words. Also used where a person only reads the phrase again. */
export function RecoveryPhraseWords({ words }: { words: string[] }) {
  return (
    <ol
      aria-label="Recovery phrase"
      data-sensitive="true"
      data-recovery-phrase=""
      className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl border bg-muted/30 p-3 font-mono text-sm min-[420px]:grid-cols-3"
    >
      {words.map((word, index) => (
        <li key={index} className="flex min-w-0 items-baseline gap-2">
          <span
            className="w-5 shrink-0 select-none text-right text-xs text-muted-foreground"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <span className="truncate" data-recovery-word="">
            {word}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function RecoveryPhraseActions({ mnemonic }: { mnemonic: string }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(mnemonic)
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  function download() {
    const text = [
      'Flare recovery phrase',
      window.location.origin,
      '',
      'Keep this private and offline. With these 24 words, anyone can read',
      'the encrypted files of this account. Without them and without your',
      'passphrase, nobody can, including you.',
      'Changing your passphrase replaces this phrase.',
      '',
      ...mnemonic
        .split(' ')
        .map((word, index) => `${String(index + 1).padStart(2, ' ')}. ${word}`),
      '',
    ].join('\n')
    saveBlobAsFile(
      new Blob([text], { type: 'text/plain' }),
      'flare-recovery-phrase.txt'
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download aria-hidden="true" />
          Download as text
        </Button>
      </div>
      {copyError && (
        <p role="alert" className="text-sm text-destructive">
          Unable to copy. Download the phrase or write it down.
        </p>
      )}
    </>
  )
}

/**
 * Shows a new recovery phrase (the mnemonic of docs/e2ee-spec.md, section
 * 5.4, step 8) and does not let the person continue until they say they
 * saved it and typed three of its words back.
 */
export function RecoveryPhrase({
  mnemonic,
  onDone,
  doneLabel = 'Continue',
  replacesOld = false,
  className,
}: {
  mnemonic: string
  onDone: () => void
  doneLabel?: string
  /** After a passphrase change or recovery: the earlier phrase stopped working. */
  replacesOld?: boolean
  className?: string
}) {
  const words = mnemonic.split(' ')
  const [step, setStep] = useState<'show' | 'check'>('show')
  const [saved, setSaved] = useState(false)
  const [positions] = useState(() => pickPositions(words.length))
  const [answers, setAnswers] = useState<string[]>(() =>
    positions.map(() => '')
  )
  const [error, setError] = useState(false)

  if (step === 'check')
    return (
      <form
        className={cn('space-y-4', className)}
        onSubmit={(event) => {
          event.preventDefault()
          const correct = positions.every(
            (position, index) =>
              answers[index].trim().toLowerCase() === words[position]
          )
          if (correct) onDone()
          else setError(true)
        }}
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Type these words from the phrase you saved, so you know your copy is
          right.
        </p>
        {positions.map((position, index) => (
          <div key={position} className="space-y-2">
            <Label htmlFor={`recovery-word-${position}`}>
              Word {position + 1}
            </Label>
            <Input
              id={`recovery-word-${position}`}
              value={answers[index]}
              onChange={(event) => {
                setError(false)
                setAnswers((previous) =>
                  previous.map((answer, at) =>
                    at === index ? event.target.value : answer
                  )
                )
              }}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              autoFocus={index === 0}
              data-sensitive="true"
              className="h-11 font-mono"
            />
          </div>
        ))}
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>
              Those words do not match. Go back and check your copy.
            </AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="h-11 w-full">
          {doneLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full"
          onClick={() => {
            setError(false)
            setStep('show')
          }}
        >
          <ArrowLeft aria-hidden="true" />
          Show the phrase again
        </Button>
      </form>
    )

  return (
    <div className={cn('space-y-4', className)}>
      <p className="text-sm leading-relaxed">
        Write these 24 words down in order and keep them offline.{' '}
        <span className="text-muted-foreground">
          They recover your account and its encrypted files if you forget your
          passphrase. Nobody else can restore them, and anyone who has them can
          read your files.
          {replacesOld && ' Your earlier recovery phrase no longer works.'}
        </span>
      </p>
      <RecoveryPhraseWords words={words} />
      <RecoveryPhraseActions mnemonic={mnemonic} />
      <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-1 h-4 w-4 accent-primary"
        />
        I saved my recovery phrase somewhere offline.
      </label>
      <Button
        type="button"
        className="h-11 w-full"
        disabled={!saved}
        onClick={() => setStep('check')}
      >
        Continue
      </Button>
    </div>
  )
}
