import { useCallback, useState } from 'react'

import { useRouter } from 'next/navigation'

import { useToast } from './use-toast'

export interface User {
  id: string
  name: string
  email: string
  image: string | null
  role: 'ADMIN' | 'USER'
  urlId: string
  vanityId: string | null
  storageUsed: number
  _count: {
    files: number
    shortenedUrls: number
  }
}

export interface PaginationData {
  total: number
  pages: number
  page: number
  limit: number
}

export interface UsersResponse {
  users: User[]
  pagination: PaginationData
}

export interface UserFormData {
  name: string
  email: string
  password?: string
  role: 'ADMIN' | 'USER'
  urlId?: string
  vanityId?: string
}

export interface UseUserManagementOptions {
  onUserDeleted?: (userId: string) => void
  onUserUpdated?: (user: User) => void
  onUserCreated?: (user: User) => void
}

export function useUserManagement(options: UseUserManagementOptions = {}) {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [pagination, setPagination] = useState<PaginationData | null>(null)
  const { toast } = useToast()
  const router = useRouter()

  const fetchUsers = useCallback(
    async (page: number = 1) => {
      try {
        setIsLoading(true)
        const response = await fetch(`/api/users?page=${page}&limit=25`)
        if (!response.ok) throw new Error('Failed to fetch users')
        const data = await response.json()
        setUsers(data.data || [])
        setPagination(data.pagination || null)
        setCurrentPage(page)
      } catch (error) {
        console.error('Error fetching users:', error)
        toast({
          title: 'Error',
          description: 'Failed to fetch users',
          variant: 'destructive',
        })
      } finally {
        setIsLoading(false)
      }
    },
    [toast]
  )

  const createUser = useCallback(
    async (formData: UserFormData) => {
      try {
        setIsLoading(true)
        const response = await fetch('/api/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(formData),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to create user')
        }

        const responseData = await response.json()
        const newUser = responseData.data

        setUsers((prevUsers) => [newUser, ...prevUsers])

        if (pagination) {
          setPagination({
            ...pagination,
            total: pagination.total + 1,
            pages: Math.ceil((pagination.total + 1) / pagination.limit),
          })
        }

        if (options.onUserCreated) {
          options.onUserCreated(newUser)
        }

        toast({
          title: 'Success',
          description: 'User created successfully',
        })

        return newUser
      } catch (error) {
        console.error('Error creating user:', error)
        toast({
          title: 'Error',
          description:
            error instanceof Error ? error.message : 'Failed to create user',
          variant: 'destructive',
        })
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [pagination, toast, options]
  )

  const updateUser = useCallback(
    async (userId: string, formData: UserFormData) => {
      try {
        setIsLoading(true)
        const response = await fetch('/api/users', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...formData, id: userId }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to update user')
        }

        const responseData = await response.json()
        const updatedUser = responseData.data

        setUsers((prevUsers) =>
          prevUsers.map((user) => (user.id === userId ? updatedUser : user))
        )

        if (options.onUserUpdated) {
          options.onUserUpdated(updatedUser)
        }

        toast({
          title: 'Success',
          description: 'User updated successfully',
        })

        return updatedUser
      } catch (error) {
        console.error('Error updating user:', error)
        toast({
          title: 'Error',
          description:
            error instanceof Error ? error.message : 'Failed to update user',
          variant: 'destructive',
        })
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [toast, options]
  )

  const deleteUser = useCallback(
    async (userId: string) => {
      try {
        setIsLoading(true)
        const response = await fetch(`/api/users/${userId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error('Failed to delete user')
        }

        setUsers((prevUsers) => prevUsers.filter((user) => user.id !== userId))

        if (pagination) {
          setPagination({
            ...pagination,
            total: pagination.total - 1,
            pages: Math.ceil((pagination.total - 1) / pagination.limit),
          })
        }

        if (options.onUserDeleted) {
          options.onUserDeleted(userId)
        }

        toast({
          title: 'Success',
          description: 'User deleted successfully',
        })

        router.refresh()
      } catch (error) {
        console.error('Error deleting user:', error)
        toast({
          title: 'Error',
          description: 'Failed to delete user',
          variant: 'destructive',
        })
      } finally {
        setIsLoading(false)
      }
    },
    [pagination, toast, router, options]
  )

  const removeUserAvatar = useCallback(
    async (userId: string) => {
      try {
        setIsLoading(true)
        const response = await fetch(`/api/users/${userId}/avatar`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error('Failed to remove avatar')
        }

        setUsers((prevUsers) =>
          prevUsers.map((user) =>
            user.id === userId ? { ...user, image: null } : user
          )
        )

        toast({
          title: 'Success',
          description: 'Avatar removed successfully',
        })
      } catch (error) {
        console.error('Error removing avatar:', error)
        toast({
          title: 'Error',
          description: 'Failed to remove avatar',
          variant: 'destructive',
        })
      } finally {
        setIsLoading(false)
      }
    },
    [toast]
  )

  return {
    users,
    isLoading,
    currentPage,
    pagination,
    fetchUsers,
    createUser,
    updateUser,
    deleteUser,
    removeUserAvatar,
  }
}
