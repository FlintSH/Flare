'use client'

import { useEffect, useRef, useState } from 'react'

type Tag = { id: string; name: string }
export type FileTagMembership = { id: string; tags: Tag[] }
type MembershipState = {
  key: string
  files: FileTagMembership[] | null
  error: string
}

const unavailable =
  'One or more files are no longer available. Close this dialog and reselect your files.'
const loadFailed =
  'Couldn’t load current file tags. Try again, or close this dialog and reselect your files.'

/** A dialog-scoped snapshot; retained grid cards are not tag membership caches. */
export function useFileTagMemberships(fileIds: string[]) {
  const valid = fileIds.length > 0 && fileIds.length <= 100
  // Primitive identity prevents grid refreshes and onChanged from refetching.
  const key = valid ? JSON.stringify([...new Set(fileIds)].sort()) : ''
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<MembershipState>({
    key: '',
    files: null,
    error: '',
  })
  const active = useRef<{ key: string; controller: AbortController } | null>(
    null
  )

  useEffect(() => {
    if (!key) return
    const ids: string[] = JSON.parse(key)
    const controller = new AbortController()
    const request = { key, controller }
    active.current = request
    setState({ key, files: null, error: '' })
    const load = async () => {
      try {
        const params = new URLSearchParams({ fileIds: ids.join(',') })
        const response = await fetch(`/api/files/tags?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok)
          throw new Error(response.status === 404 ? unavailable : loadFailed)
        const result = await response.json()
        const files: FileTagMembership[] = result.data?.files
        if (
          !Array.isArray(files) ||
          files.length !== ids.length ||
          new Set(files.map((file) => file.id)).size !== ids.length ||
          files.some(
            (file) => !ids.includes(file.id) || !Array.isArray(file.tags)
          )
        )
          throw new Error(unavailable)
        if (!controller.signal.aborted && active.current === request)
          setState({ key, files, error: '' })
      } catch (error) {
        if (!controller.signal.aborted && active.current === request)
          setState({
            key,
            files: null,
            error:
              error instanceof Error && error.message === unavailable
                ? unavailable
                : loadFailed,
          })
      }
    }
    void load()
    return () => {
      controller.abort()
      if (active.current === request) active.current = null
    }
  }, [key, attempt])

  const files = state.key === key ? state.files : null
  const error = !valid
    ? 'Choose between 1 and 100 files, then reopen tags.'
    : state.key === key
      ? state.error
      : ''

  const request = active.current
  const update = async (tag: Tag, action: 'add' | 'remove') => {
    if (!files || !request || request.key !== key || active.current !== request)
      return null
    try {
      const response = await fetch('/api/files/tags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileIds: files.map((file) => file.id),
          tagId: tag.id,
          action,
        }),
        signal: request.controller.signal,
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(
          result.error || 'Couldn’t update tags. Please try again.'
        )
      }
    } catch (error) {
      if (request.controller.signal.aborted || active.current !== request)
        return null
      throw error
    }
    if (request.controller.signal.aborted || active.current !== request)
      return null
    const next = files.map((file) => ({
      id: file.id,
      tags:
        action === 'remove'
          ? file.tags.filter((item) => item.id !== tag.id)
          : [...file.tags.filter((item) => item.id !== tag.id), tag],
    }))
    setState({ key, files: next, error: '' })
    return next
  }

  return {
    files,
    error,
    loading: valid && !files && !error,
    reload: () => {
      setState({ key, files: null, error: '' })
      setAttempt((value) => value + 1)
    },
    update,
  }
}
