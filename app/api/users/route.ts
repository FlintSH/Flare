import { UserResponse, UserSchema } from '@/types/dto/user'
import { hash } from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

import {
  HTTP_STATUS,
  apiError,
  apiResponse,
  paginatedResponse,
} from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'

export async function GET(req: Request) {
  try {
    const { response } = await requireAdmin()
    if (response) return response

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '25')
    const skip = (page - 1) * limit

    const total = await prisma.user.count()

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        urlId: true,
        storageUsed: true,
        _count: {
          select: {
            files: true,
            shortenedUrls: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limit,
    })

    const pagination = {
      total,
      pageCount: Math.ceil(total / limit),
      page,
      limit,
    }

    return paginatedResponse<UserResponse[]>(users, pagination)
  } catch (error) {
    console.error('Error fetching users:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function POST(req: Request) {
  try {
    const { response } = await requireAdmin()
    if (response) return response

    const json = await req.json()

    const result = UserSchema.safeParse(json)
    if (!result.success) {
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    const body = result.data

    const exists = await prisma.user.findUnique({
      where: { email: body.email },
    })

    if (exists) {
      return apiError('User already exists', HTTP_STATUS.BAD_REQUEST)
    }

    const generateUrlId = () =>
      Array.from({ length: 5 }, () => {
        const chars =
          '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        return chars.charAt(Math.floor(Math.random() * chars.length))
      }).join('')

    let urlId = generateUrlId()
    let isUnique = false
    while (!isUnique) {
      const existing = await prisma.user.findUnique({
        where: { urlId },
      })
      if (!existing) {
        isUnique = true
      } else {
        urlId = generateUrlId()
      }
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        password: body.password ? await hash(body.password, 10) : undefined,
        role: body.role,
        urlId,
        uploadToken: uuidv4(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        urlId: true,
        storageUsed: true,
        _count: {
          select: {
            files: true,
            shortenedUrls: true,
          },
        },
      },
    })

    return apiResponse<UserResponse>(user)
  } catch (error) {
    console.error('Error creating user:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function PUT(req: Request) {
  try {
    const { response } = await requireAdmin()
    if (response) return response

    const json = await req.json()

    const result = UserSchema.safeParse(json)
    if (!result.success) {
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    const body = result.data

    if (!body.id) {
      return apiError('User ID is required', HTTP_STATUS.BAD_REQUEST)
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: body.id },
    })

    if (!existingUser) {
      return apiError('User not found', HTTP_STATUS.NOT_FOUND)
    }

    if (body.urlId) {
      const existingUrlId = await prisma.user.findUnique({
        where: { urlId: body.urlId },
      })
      if (existingUrlId && existingUrlId.id !== body.id) {
        return apiError('URL ID is already in use', HTTP_STATUS.BAD_REQUEST)
      }
    }

    const updateData = {
      updatedAt: new Date(),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.role !== undefined && { role: body.role }),
      ...(body.password && { password: await hash(body.password, 10) }),
      ...(body.urlId && { urlId: body.urlId }),
    }

    if (body.urlId && body.urlId !== existingUser.urlId) {
      try {
        const storageProvider = await getStorageProvider()
        const oldPath = `uploads/${existingUser.urlId}`
        const newPath = `uploads/${body.urlId}`
        await storageProvider.renameFolder(oldPath, newPath)

        const files = await prisma.file.findMany({
          where: { userId: body.id },
          select: { id: true, path: true, urlPath: true },
        })

        for (const file of files) {
          await prisma.file.update({
            where: { id: file.id },
            data: {
              path: file.path.replace(`${oldPath}/`, `${newPath}/`),
              urlPath: file.urlPath.replace(
                `/${existingUser.urlId}/`,
                `/${body.urlId}/`
              ),
            },
          })
        }
      } catch (error) {
        console.error('Error renaming user folder:', error)
        return apiError(
          'Failed to rename user folder',
          HTTP_STATUS.INTERNAL_SERVER_ERROR
        )
      }
    }

    const user = await prisma.user.update({
      where: { id: body.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        urlId: true,
        storageUsed: true,
        _count: {
          select: {
            files: true,
            shortenedUrls: true,
          },
        },
      },
    })

    return apiResponse<UserResponse>(user)
  } catch (error) {
    console.error('Error updating user:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
