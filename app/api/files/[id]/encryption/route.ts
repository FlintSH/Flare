import { NextResponse } from 'next/server'

import { authorizeFile } from '@/lib/files/delivery'
import {
  encryptedRecordSelect,
  encryptedRecordsWire,
} from '@/lib/files/encrypted'
import { preflight } from '@/lib/http/cors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { mbToBytes } from '@/lib/utils/size'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/encryption', {
  failure: { message: 'Failed to read the encryption records' },
  logger: loggers.files,
  cors: 'file',
})

/**
 * The records a client needs to open an encrypted file it may fetch: the
 * header, the sealed name and type, the password stanza if there is one,
 * and the size of the ciphertext (docs/e2ee-spec.md, section 9.1). The
 * owner also gets the account stanza. None of these is secret, and none
 * opens without a key that the server does not have. The same rules decide
 * who may read them as decide who may fetch the ciphertext.
 */
export const GET = api(async (request, { params }: Context) => {
  const { id } = await params
  const grant = await authorizeFile(request, { id }, 'api', {
    ...encryptedRecordSelect,
    urlPath: true,
    size: true,
  })
  if (grant instanceof Response) return grant
  const { file, session } = grant
  const records = encryptedRecordsWire(file, {
    forOwner: session?.user?.id === file.userId,
  })
  if (!records)
    return NextResponse.json(
      { success: false, error: 'This file is not encrypted' },
      { status: 400 }
    )
  return NextResponse.json(
    {
      id: file.id,
      urlPath: file.urlPath,
      sizeBytes: Math.round(mbToBytes(file.size)),
      ...records,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const OPTIONS = preflight('file')
