import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { isSameOriginRequest } from '@/lib/security/request-origin'
import { TagError } from '@/lib/tags/service'

import { UploadError } from './options'
import { uploadProfileOptionsSchema } from './schema'

export async function profileSession() {
  const session = await getAccessSession()
  return session?.user ?? null
}

export function profileMutationGuard(request: Request, requireJson = true) {
  if (!isSameOriginRequest(request))
    return Response.json(
      { error: 'Cross-origin changes are not allowed.' },
      { status: 403 }
    )
  if (
    requireJson &&
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    return Response.json({ error: 'Use application/json.' }, { status: 415 })
  return null
}

export function profileError(error: unknown) {
  if (error instanceof TagError)
    return Response.json({ error: error.message }, { status: error.status })
  if (error instanceof z.ZodError)
    return Response.json(
      { error: error.issues[0]?.message || 'Invalid profile.' },
      { status: 400 }
    )
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
    return Response.json(
      { error: 'A profile with this name already exists.' },
      { status: 409 }
    )
  return Response.json(
    { error: 'Could not save upload profile.' },
    { status: 500 }
  )
}

export function profileView(profile: {
  id: string
  name: string
  options: unknown
  updatedAt: Date
}) {
  return {
    id: profile.id,
    name: profile.name,
    options: uploadProfileOptionsSchema.parse(profile.options),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

/** Generator selection is always checked against the session owner. */
export async function generatorProfile(
  userId: string,
  selected?: string | null
) {
  if (!selected) return null
  const profile = await prisma.uploadProfile.findFirst({
    where: { id: selected, userId },
  })
  if (!profile) throw new UploadError('Upload profile not found.', 404)
  return profile.id
}
