import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type FileVisibility = 'PUBLIC' | 'PRIVATE'

interface FileData {
  id: string
  name: string
  mimeType: string
  size: number
  visibility: FileVisibility
  uploadedAt: Date
  urlPath: string
  isPaste: boolean
  password: string | null
}

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/files', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.files,
})

export const GET = api(async (request, { params }: Context) => {
  await requireSession('content.read')

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const search = searchParams.get('search') || ''
  const visibility = searchParams.get('visibility') as FileVisibility | null
  const type = searchParams.get('type') || ''

  const skip = (page - 1) * limit

  const { id } = await params

  const where = {
    userId: id,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            {
              ocrText: { contains: search, mode: 'insensitive' as const },
            },
          ],
        }
      : {}),
    ...(visibility ? { visibility } : {}),
    ...(type ? { mimeType: { startsWith: type } } : {}),
  }

  const total = await prisma.file.count({ where })

  const files = await prisma.file.findMany({
    where,
    orderBy: { uploadedAt: 'desc' },
    skip,
    take: limit,
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      visibility: true,
      uploadedAt: true,
      urlPath: true,
      isPaste: true,
      password: true,
    },
  })

  const transformedFiles = files.map(({ password, ...file }: FileData) => ({
    ...file,
    visibility: password ? 'PROTECTED' : file.visibility,
  }))

  return {
    files: transformedFiles,
    pagination: {
      total,
      pages: Math.ceil(total / limit),
      page,
      limit,
    },
  }
})
