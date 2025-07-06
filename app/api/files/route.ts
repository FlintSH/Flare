import {
  FileMetadata,
  FileUploadFormDataSchema,
  FileUploadResponse,
} from '@/types/dto/file'
import { Prisma } from '@prisma/client'
import { join } from 'path'

import {
  HTTP_STATUS,
  apiError,
  apiResponse,
  paginatedResponse,
} from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getUniqueFilename } from '@/lib/files/filename'
import { processImageOCR } from '@/lib/ocr'
import { getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

export async function POST(req: Request) {
  let filePath = ''

  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const formData = await req.formData()

    const uploadedFile = formData.get('file') as File
    const visibility =
      (formData.get('visibility') as 'PUBLIC' | 'PRIVATE') || 'PUBLIC'
    const password = formData.get('password') as string | null

    const result = FileUploadFormDataSchema.safeParse({
      file: uploadedFile,
      visibility,
      password,
    })

    if (!result.success) {
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    const config = await getConfig()
    const maxSize = config.settings.general.storage.maxUploadSize
    const maxBytes =
      maxSize.value * (maxSize.unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
    const quotasEnabled = config.settings.general.storage.quotas.enabled
    const defaultQuota = config.settings.general.storage.quotas.default

    if (uploadedFile.size > maxBytes) {
      return apiError(
        `Maximum file size is ${maxSize.value}${maxSize.unit}`,
        HTTP_STATUS.PAYLOAD_TOO_LARGE
      )
    }

    if (quotasEnabled && user.role !== 'ADMIN') {
      const quotaMB =
        defaultQuota.value * (defaultQuota.unit === 'GB' ? 1024 : 1)
      const fileSizeMB = bytesToMB(uploadedFile.size)

      if (user.storageUsed + fileSizeMB > quotaMB) {
        return apiError(
          `You have reached your storage quota of ${defaultQuota.value}${defaultQuota.unit}`,
          HTTP_STATUS.PAYLOAD_TOO_LARGE
        )
      }
    }

    const { urlSafeName, displayName } = await getUniqueFilename(
      join('uploads', user.urlId),
      uploadedFile.name,
      user.randomizeFileUrls
    )

    filePath = join('uploads', user.urlId, urlSafeName)
    const urlPath = `/${user.urlId}/${urlSafeName}`

    const storageProvider = await getStorageProvider()
    const bytes = await uploadedFile.arrayBuffer()
    await storageProvider.uploadFile(
      Buffer.from(bytes),
      filePath,
      uploadedFile.type
    )

    const fileRecord = await prisma.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          name: displayName,
          urlPath,
          mimeType: uploadedFile.type,
          size: bytesToMB(uploadedFile.size),
          path: filePath,
          visibility: visibility,
          password: password,
          userId: user.id,
        },
      })

      await tx.user.update({
        where: { id: user.id },
        data: {
          storageUsed: {
            increment: bytesToMB(uploadedFile.size),
          },
        },
      })

      return file
    })

    if (uploadedFile.type.startsWith('image/')) {
      processImageOCR(filePath, fileRecord.id).catch((error) => {
        console.error('Background OCR processing failed:', error)
      })
    }

    const baseUrl =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : process.env.NEXTAUTH_URL?.replace(/\/$/, '') || ''
    const fullUrl = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`

    const responseData: FileUploadResponse = {
      url: `${fullUrl}${urlPath}`,
      name: displayName,
      size: uploadedFile.size,
      type: uploadedFile.type,
    }

    return apiResponse<FileUploadResponse>(responseData)
  } catch (error) {
    console.error('Upload error:', error)

    if (filePath) {
      try {
        const storageProvider = await getStorageProvider()
        await storageProvider.deleteFile(filePath)
        console.log('Cleaned up file after error:', filePath)
      } catch (unlinkError) {
        console.error('Failed to clean up file:', unlinkError)
      }
    }

    return apiError(
      error instanceof Error ? error.message : 'An unexpected error occurred',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}

export async function GET(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '24')
    const search = searchParams.get('search') || ''
    const sortBy = searchParams.get('sortBy') || 'newest'
    const types = searchParams.get('types')?.split(',') || []
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const visibilityFilters = searchParams.get('visibility')?.split(',') || []
    const offset = (page - 1) * limit

    const where: Prisma.FileWhereInput = {
      userId: user.id,
    }

    const conditions: Prisma.FileWhereInput[] = []

    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { ocrText: { contains: search, mode: 'insensitive' } },
        ],
      })
    }

    if (types.length > 0) {
      conditions.push({ mimeType: { in: types } })
    }

    if (dateFrom || dateTo) {
      const dateFilter: Prisma.DateTimeFilter = {}
      if (dateFrom) {
        const startDate = new Date(dateFrom)
        dateFilter.gte = startDate
      }
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      conditions.push({ uploadedAt: dateFilter })
    }

    if (visibilityFilters.length > 0) {
      const visibilityConditions = []

      for (const filter of visibilityFilters) {
        if (filter === 'hasPassword') {
          visibilityConditions.push({ password: { not: null } })
        } else {
          visibilityConditions.push({
            visibility: filter.toUpperCase() as 'PUBLIC' | 'PRIVATE',
          })
        }
      }

      conditions.push({ OR: visibilityConditions })
    }

    if (conditions.length > 0) {
      where.AND = conditions
    }

    const orderBy: Prisma.FileOrderByWithRelationInput = {}
    switch (sortBy) {
      case 'oldest':
        orderBy.uploadedAt = 'asc'
        break
      case 'largest':
        orderBy.size = 'desc'
        break
      case 'smallest':
        orderBy.size = 'asc'
        break
      case 'most-viewed':
        orderBy.views = 'desc'
        break
      case 'least-viewed':
        orderBy.views = 'asc'
        break
      case 'most-downloaded':
        orderBy.downloads = 'desc'
        break
      case 'least-downloaded':
        orderBy.downloads = 'asc'
        break
      case 'name':
        orderBy.name = 'asc'
        break
      default:
        orderBy.uploadedAt = 'desc'
    }

    const total = await prisma.file.count({ where })

    const files = await prisma.file.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      select: {
        id: true,
        name: true,
        urlPath: true,
        mimeType: true,
        size: true,
        uploadedAt: true,
        visibility: true,
        password: true,
        views: true,
        downloads: true,
        user: {
          select: {
            urlId: true,
          },
        },
      },
    })

    const filesList = files.map((file) => ({
      ...file,
      hasPassword: Boolean(file.password),
    })) as FileMetadata[]

    const pagination = {
      total,
      pageCount: Math.ceil(total / limit),
      page,
      limit,
    }

    return paginatedResponse<FileMetadata[]>(filesList, pagination)
  } catch (error) {
    console.error('Error fetching files:', error)
    return apiError('Failed to fetch files', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
