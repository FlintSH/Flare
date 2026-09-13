import { useCallback, useEffect, useRef, useState } from 'react'

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
  vanityId?: string | null
}

export interface UseUserManagementOptions {
  search?: string
  role?: string
  onUserDeleted?: (userId: string) => void
  onUserUpdated?: (user: User) => void
  onUserCreated?: (user: User) => void
}

export function useUserManagement(options: UseUserManagementOptions = {}) {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pendingMutations, setPendingMutations] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pagination, setPagination] = useState<PaginationData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const pendingRequest = useRef<AbortController | null>(null)
  const search = options.search || ''
  const role = options.role || 'ALL'
  useEffect(() => () => pendingRequest.current?.abort(), [])
  const { toast } = useToast()
  const router = useRouter()

  const fetchUsers = useCallback(
    async (page: number = 1) => {
      pendingRequest.current?.abort()
      const controller = new AbortController()
      pendingRequest.current = controller
      try {
        setIsLoading(true)
        setLoadError(false)
        const params = new URLSearchParams({
          page: String(page),
          limit: '25',
          search,
          role,
        })
        const response = await fetch(`/api/users?${params}`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Failed to fetch users')
        const data = await response.json()
        if (controller.signal.aborted) return
        setUsers(data.data || [])
        setPagination(
          data.pagination
            ? { ...data.pagination, pages: data.pagination.pageCount }
            : null
        )
        setCurrentPage(data.pagination?.page ?? page)
      } catch (error) {
        if (controller.signal.aborted) return
        setLoadError(true)
        console.error('Error fetching users:', error)
        toast({
          title: 'Error',
          description: 'Failed to fetch users',
          variant: 'destructive',
        })
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    },
    [toast, search, role]
  )

  const createUser = useCallback(
    async (formData: UserFormData) => {
      try {
        setPendingMutations((count) => count + 1)
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

        await fetchUsers(1)

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
        setPendingMutations((count) => count - 1)
      }
    },
    [fetchUsers, toast, options]
  )

  const updateUser = useCallback(
    async (userId: string, formData: UserFormData) => {
      try {
        setPendingMutations((count) => count + 1)
        const response = await fetch('/api/users', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...formData,
            password: formData.password || undefined,
            vanityId: formData.vanityId?.trim() || null,
            id: userId,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to update user')
        }

        const responseData = await response.json()
        const updatedUser = responseData.data

        await fetchUsers(currentPage)

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
        setPendingMutations((count) => count - 1)
      }
    },
    [currentPage, fetchUsers, toast, options]
  )

  const deleteUser = useCallback(
    async (userId: string) => {
      try {
        setPendingMutations((count) => count + 1)
        const response = await fetch(`/api/users/${userId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error('Failed to delete user')
        }

        await fetchUsers(currentPage)

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
        setPendingMutations((count) => count - 1)
      }
    },
    [currentPage, fetchUsers, toast, router, options]
  )

  const removeUserAvatar = useCallback(
    async (userId: string) => {
      try {
        setPendingMutations((count) => count + 1)
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
        setPendingMutations((count) => count - 1)
      }
    },
    [toast]
  )

  return {
    users,
    isLoading: isLoading || pendingMutations > 0,
    loadError,
    currentPage,
    pagination,
    fetchUsers,
    createUser,
    updateUser,
    deleteUser,
    removeUserAvatar,
  }
}
