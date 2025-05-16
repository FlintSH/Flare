import { NextResponse } from 'next/server'

import { Prisma } from '@prisma/client'
import { compare, hash } from 'bcryptjs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'

const updateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
  image: z.string().optional(),
  randomizeFileUrls: z.boolean().optional(),
})

export async function PUT(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const json = await req.json()
    const body = updateProfileSchema.parse(json)

    // If email is being changed, check if it's already taken
    if (body.email) {
      const existingUser = await prisma.user.findUnique({
        where: {
          email: body.email,
          NOT: {
            id: user.id,
          },
        },
      })

      if (existingUser) {
        return NextResponse.json(
          { error: 'Email already taken' },
          { status: 400 }
        )
      }
    }

    // If password is being changed, verify current password
    if (body.newPassword) {
      if (!body.currentPassword) {
        return NextResponse.json(
          { error: 'Current password is required' },
          { status: 400 }
        )
      }

      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { password: true },
      })

      if (!userData?.password) {
        return NextResponse.json(
          { error: 'Invalid credentials' },
          { status: 400 }
        )
      }

      const isPasswordValid = await compare(
        body.currentPassword,
        userData.password
      )

      if (!isPasswordValid) {
        return NextResponse.json(
          { error: 'Invalid credentials' },
          { status: 400 }
        )
      }
    }

    // Update user data
    const updateData: Prisma.UserUpdateInput = {}
    if (body.name) updateData.name = body.name
    if (body.email) updateData.email = body.email
    if (body.newPassword) updateData.password = await hash(body.newPassword, 10)
    if (body.image) updateData.image = body.image
    if (typeof body.randomizeFileUrls === 'boolean')
      updateData.randomizeFileUrls = body.randomizeFileUrls

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        randomizeFileUrls: true,
      },
    })

    return NextResponse.json(updatedUser)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    console.error('Profile update error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    // Get user's files to nuke them from storage
    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        files: {
          select: {
            path: true,
          },
        },
      },
    })

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    for (const file of userData.files) {
      try {
        await unlink(join(process.cwd(), file.path))
      } catch (error) {
        console.error(`Error deleting file ${file.path}:`, error)
      }
    }

    // Delete user's avatar if they have one
    if (userData.image?.startsWith('/avatars/')) {
      try {
        await unlink(join(process.cwd(), 'public', userData.image))
      } catch (error) {
        console.error('Error deleting avatar:', error)
      }
    }

    // Delete user from database and all their data
    await prisma.user.delete({
      where: { id: user.id },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Account deletion error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
