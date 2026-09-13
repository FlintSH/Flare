import { Prisma, User, UserRole } from '@prisma/client'
import { nanoid } from 'nanoid'
import { v4 as uuidv4 } from 'uuid'

type TransactionClient = Prisma.TransactionClient

function generateUrlId() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  return nanoid(5)
    .split('')
    .map((char) => {
      const index = Math.floor((alphabet.length * char.charCodeAt(0)) / 256)
      return alphabet[index]
    })
    .join('')
}

export async function generateUniqueUrlId(tx: TransactionClient) {
  let urlId = generateUrlId()
  let isUnique = false
  while (!isUnique) {
    const existing = await tx.user.findUnique({ where: { urlId } })
    if (!existing) {
      isUnique = true
    } else {
      urlId = generateUrlId()
    }
  }
  return urlId
}

interface CreateUserInput {
  email: string
  name: string
  image?: string | null
  password?: string
  oidcSubject?: string
  role?: UserRole
  emailVerified?: Date
  emailVerifiedFor?: string
  emailVerificationSource?: string
  emailExempt?: boolean
}

export async function createUser(
  tx: TransactionClient,
  input: CreateUserInput
): Promise<User> {
  const urlId = await generateUniqueUrlId(tx)

  let role = input.role
  if (!role) {
    const userCount = await tx.user.count()
    role = userCount === 0 ? 'ADMIN' : 'USER'
  }

  return tx.user.create({
    data: {
      email: input.email,
      name: input.name,
      image: input.image,
      password: input.password,
      oidcSubject: input.oidcSubject,
      emailVerified: input.emailVerified,
      emailVerifiedFor: input.emailVerifiedFor,
      emailVerificationSource: input.emailVerificationSource,
      emailExempt: input.emailExempt,
      urlId,
      role,
      uploadToken: uuidv4(),
    },
  })
}
