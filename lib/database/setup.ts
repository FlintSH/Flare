import { prisma } from './prisma'

export async function checkSetupCompletion(): Promise<boolean> {
  try {
    const userCount = await prisma.user.count()
    return userCount > 0
  } catch (error) {
    console.error('Setup check error:', error)
    return false
  }
}
