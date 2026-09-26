'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import Image from 'next/image'
import { useRouter } from 'next/navigation'

import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Eye,
  EyeOff,
  File,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  Lock,
  LogOut,
  MoreVertical,
  Music,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserX,
  Video,
} from 'lucide-react'
import { useSession } from 'next-auth/react'

import { UserEmailControls } from '@/components/email/user-email-controls'
import { PermissionGate } from '@/components/roles/permission-gate'
import { RoleBadges } from '@/components/roles/role-badges'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { RoleSummary } from '@/lib/permissions/catalog'
import { formatFileSize } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { sanitizeUrl } from '@/lib/utils/url'

import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'
import { UserFormData, useUserManagement } from '@/hooks/use-user-management'

interface User {
  id: string
  name: string
  email: string
  image: string | null
  roles: RoleSummary[]
  urlId: string
  vanityId: string | null
  storageUsed: number
  _count: {
    files: number
    shortenedUrls: number
  }
}

interface File {
  id: string
  name: string
  mimeType: string
  size: number
  visibility: 'PUBLIC' | 'PRIVATE'
  password?: string | null
  uploadedAt: string
  urlPath: string
}

interface ShortenedUrl {
  id: string
  shortCode: string
  targetUrl: string
  clicks: number
  createdAt: string
}

interface PaginationData {
  total: number
  pages: number
  page: number
  limit: number
}

interface FileFilters {
  search: string
  visibility: 'PUBLIC' | 'PRIVATE' | null
  type: string
}

interface FileResponse {
  files: File[]
  pagination: PaginationData
}

interface UrlResponse {
  urls: ShortenedUrl[]
  pagination: PaginationData
}

function UserTableSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-xl border bg-card"
      aria-label="Loading users"
      aria-busy="true"
    >
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead className="pl-4">User</TableHead>
            <TableHead className="hidden sm:table-cell">Roles</TableHead>
            <TableHead className="hidden lg:table-cell">URL ID</TableHead>
            <TableHead className="hidden lg:table-cell">Files</TableHead>
            <TableHead className="hidden lg:table-cell">Storage Used</TableHead>
            <TableHead className="hidden lg:table-cell">URLs</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }, (_, index) => (
            <TableRow key={index}>
              <TableCell className="py-3 pl-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24 sm:w-36" />
                    <Skeleton className="h-3 w-28 sm:w-44" />
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Skeleton className="h-4 w-14" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="h-4 w-14" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="h-4 w-8" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="h-4 w-8" />
              </TableCell>
              <TableCell className="pr-4">
                <Skeleton className="ml-auto h-8 w-24" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function getPaginationRange(
  currentPage: number,
  totalPages: number,
  maxVisible: number = 5
) {
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  let start = Math.max(currentPage - Math.floor(maxVisible / 2), 1)
  let end = start + maxVisible - 1

  if (end > totalPages) {
    end = totalPages
    start = Math.max(end - maxVisible + 1, 1)
  }

  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

interface FileSettingsDialogProps {
  file: File | null
  isOpen: boolean
  onClose: () => void
  onSave: (visibility: 'PUBLIC' | 'PRIVATE', password?: string) => Promise<void>
}

function FileSettingsDialog({
  file,
  isOpen,
  onClose,
  onSave,
}: FileSettingsDialogProps) {
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PRIVATE')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (file) {
      setVisibility(file.visibility)
      setPassword('')
    }
  }, [file])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await onSave(visibility, password || undefined)
      onClose()
    } catch (error) {
      console.error('Error saving file settings:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File Settings</DialogTitle>
          <DialogDescription>
            Update visibility and protection settings for {file?.name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="visibility">Visibility</Label>
              <Select
                value={visibility}
                onValueChange={(value: 'PUBLIC' | 'PRIVATE') =>
                  setVisibility(value)
                }
              >
                <SelectTrigger id="visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Public
                    </div>
                  </SelectItem>
                  <SelectItem value="PRIVATE">
                    <div className="flex items-center gap-2">
                      <EyeOff className="h-4 w-4" />
                      Private
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password-protection">Password Protection</Label>
              <Input
                id="password-protection"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave empty for no password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function UserList() {
  const router = useRouter()
  const { update: refreshSession } = useSession()
  const { can, user: actor } = usePermissions()
  const [availableRoles, setAvailableRoles] = useState<RoleSummary[]>([])
  const [roleLoadError, setRoleLoadError] = useState('')
  const canManageUser = (target: User) =>
    can('administrator') ||
    (target.id !== actor?.id &&
      !target.roles.some((role) =>
        role.permissions.some(
          (permission) =>
            !(actor?.permissions as readonly string[] | undefined)?.includes(
              permission
            )
        )
      ) &&
      Math.max(0, ...target.roles.map((role) => role.position)) <
        highestPosition)
  const highestPosition = Math.max(
    0,
    ...(actor?.roles ?? []).map((role) => role.position)
  )
  useEffect(() => {
    fetch('/api/roles')
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok)
          throw new Error(result.error || 'Could not load roles.')
        setAvailableRoles(result.roles)
      })
      .catch((error) => setRoleLoadError(error.message))
  }, [])
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('ALL')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250)
    return () => clearTimeout(timer)
  }, [search])
  const {
    users,
    isLoading,
    currentPage,
    pagination,
    loadError,
    fetchUsers,
    createUser,
    updateUser,
    deleteUser,
    removeUserAvatar,
  } = useUserManagement({ search: query, roleId: role })

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isViewingFiles, setIsViewingFiles] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [viewingUser, setViewingUser] = useState<User | null>(null)
  const filesRequest = useRef(0)
  const urlsRequest = useRef(0)
  const [filesLoading, setFilesLoading] = useState(false)
  const [urlsLoading, setUrlsLoading] = useState(false)
  const [userFiles, setUserFiles] = useState<File[]>([])
  const [userUrls, setUserUrls] = useState<ShortenedUrl[]>([])
  const [formData, setFormData] = useState<UserFormData>({
    name: '',
    email: '',
    password: '',
    roleIds: [],
  })
  const [fileFilters, setFileFilters] = useState<FileFilters>({
    search: '',
    visibility: null,
    type: '',
  })
  const [urlSearch, setUrlSearch] = useState('')
  const [filePage, setFilePage] = useState(1)
  const [urlPage, setUrlPage] = useState(1)
  const [filePagination, setFilePagination] = useState<PaginationData | null>(
    null
  )
  const [urlPagination, setUrlPagination] = useState<PaginationData | null>(
    null
  )
  const { toast } = useToast()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isFileSettingsOpen, setIsFileSettingsOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isFileDeleteDialogOpen, setIsFileDeleteDialogOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<User | null>(null)
  const [userToSignOut, setUserToSignOut] = useState<User | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  const fetchUserFiles = useCallback(
    async (userId: string, page: number) => {
      const requestId = ++filesRequest.current
      setFilesLoading(true)
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: '10',
        })

        if (fileFilters.search) {
          params.set('search', fileFilters.search)
        }
        if (fileFilters.visibility) {
          params.set('visibility', fileFilters.visibility)
        }
        if (fileFilters.type) {
          params.set('type', fileFilters.type)
        }

        const response = await fetch(`/api/users/${userId}/files?${params}`)
        if (!response.ok) throw new Error('Failed to fetch user files')
        const data: FileResponse = await response.json()
        if (requestId !== filesRequest.current) return
        setUserFiles(data.files)
        setFilePagination(data.pagination)
        setFilePage(page)
      } catch (error) {
        if (requestId !== filesRequest.current) return
        console.error('Error fetching user files:', error)
        toast({
          title: 'Error',
          description: 'Failed to fetch user files',
          variant: 'destructive',
        })
      } finally {
        if (requestId === filesRequest.current) setFilesLoading(false)
      }
    },
    [fileFilters, toast]
  )

  const fetchUserUrls = useCallback(
    async (userId: string, page: number) => {
      const requestId = ++urlsRequest.current
      setUrlsLoading(true)
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: '10',
        })

        if (urlSearch) {
          params.set('search', urlSearch)
        }

        const response = await fetch(`/api/users/${userId}/urls?${params}`)
        if (!response.ok) throw new Error('Failed to fetch user URLs')
        const data: UrlResponse = await response.json()
        if (requestId !== urlsRequest.current) return
        setUserUrls(data.urls)
        setUrlPagination(data.pagination)
        setUrlPage(page)
      } catch (error) {
        if (requestId !== urlsRequest.current) return
        console.error('Error fetching user URLs:', error)
        toast({
          title: 'Error',
          description: 'Failed to fetch user URLs',
          variant: 'destructive',
        })
      } finally {
        if (requestId === urlsRequest.current) setUrlsLoading(false)
      }
    },
    [urlSearch, toast]
  )

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    if (viewingUser) {
      const timer = setTimeout(() => {
        fetchUserFiles(viewingUser.id, 1)
      }, 300)

      return () => clearTimeout(timer)
    }
  }, [fileFilters, viewingUser, fetchUserFiles])

  useEffect(() => {
    if (viewingUser) {
      const timer = setTimeout(() => {
        fetchUserUrls(viewingUser.id, 1)
      }, 300)

      return () => clearTimeout(timer)
    }
  }, [urlSearch, viewingUser, fetchUserUrls])

  const notifyUserOfChanges = async (userId: string) => {
    try {
      await fetch(`/api/users/${userId}/login`, {
        method: 'POST',
      })
    } catch (error) {
      console.error('Failed to notify user of changes:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    try {
      if (editingUser) {
        const { roleIds, ...identity } = formData
        await updateUser(editingUser.id, {
          ...(can('users.update') ? identity : {}),
          ...(can('users.roles') ? { roleIds } : {}),
        })
        if (editingUser.id === actor?.id) {
          await refreshSession()
          router.refresh()
        } else if (can('users.sessions'))
          await notifyUserOfChanges(editingUser.id)
      } else {
        const { roleIds, ...identity } = formData
        await createUser({
          ...identity,
          ...(can('users.roles') ? { roleIds } : {}),
        })
      }
      setIsDialogOpen(false)
    } catch (error) {
      console.error('Error saving user:', error)
    }
  }

  const handleEdit = (user: User) => {
    setEditingUser(user)
    setFormData({
      name: user.name,
      email: user.email,
      roleIds: user.roles
        .filter((role) => role.systemKey !== 'everyone')
        .map((role) => role.id),
      urlId: user.urlId,
      vanityId: user.vanityId || '',
    })
    setIsDialogOpen(true)
  }

  const handleNew = () => {
    setEditingUser(null)
    setFormData({
      name: '',
      email: '',
      password: '',
      roleIds: [],
    })
    setIsDialogOpen(true)
  }

  const handleViewFiles = (user: User) => {
    filesRequest.current++
    urlsRequest.current++
    setUserFiles([])
    setUserUrls([])
    setFilePagination(null)
    setUrlPagination(null)
    setFilesLoading(true)
    setUrlsLoading(true)
    setFileFilters({ search: '', visibility: null, type: '' })
    setUrlSearch('')
    setViewingUser(user)
    setIsViewingFiles(true)
  }

  const handleFileFilterChange = (filters: Partial<FileFilters>) => {
    const newFilters = { ...fileFilters, ...filters }
    setFileFilters(newFilters)
  }

  const handleUrlSearchChange = (search: string) => {
    setUrlSearch(search)
  }

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/'))
      return <ImageIcon className="h-4 w-4" aria-label="Image file" />
    if (mimeType.startsWith('text/')) return <FileText className="h-4 w-4" />
    if (mimeType.startsWith('application/pdf'))
      return <FileText className="h-4 w-4" />
    if (
      mimeType.startsWith('application/msword') ||
      mimeType.startsWith(
        'application/vnd.openxmlformats-officedocument.wordprocessingml'
      )
    )
      return <FileText className="h-4 w-4" />
    if (
      mimeType.startsWith('application/vnd.ms-excel') ||
      mimeType.startsWith(
        'application/vnd.openxmlformats-officedocument.spreadsheetml'
      )
    )
      return <FileText className="h-4 w-4" />
    if (mimeType.startsWith('video/')) return <Video className="h-4 w-4" />
    if (mimeType.startsWith('audio/')) return <Music className="h-4 w-4" />
    if (
      mimeType.startsWith('application/zip') ||
      mimeType.startsWith('application/x-rar-compressed')
    )
      return <Archive className="h-4 w-4" />
    return <File className="h-4 w-4" />
  }

  const getFilePreview = (file: File) => {
    if (file.mimeType.startsWith('image/')) {
      return (
        <div className="relative w-10 h-10 rounded overflow-hidden flex items-center justify-center bg-muted">
          <Image
            src={`/api/files/${file.id}/thumbnail`}
            alt={file.name}
            fill
            className="object-cover"
            sizes="40px"
            priority={false}
            loading="lazy"
            // Animated GIFs are flattened/broken by the optimizer; serve as-is.
            unoptimized={file.mimeType === 'image/gif'}
          />
        </div>
      )
    }
    return (
      <div className="w-10 h-10 rounded flex items-center justify-center bg-muted">
        {getFileIcon(file.mimeType)}
      </div>
    )
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!viewingUser) return

    try {
      const response = await fetch(
        `/api/users/${viewingUser.id}/files/${fileId}`,
        {
          method: 'DELETE',
        }
      )

      if (!response.ok) {
        throw new Error('Failed to delete file')
      }

      toast({
        title: 'Success',
        description: 'File deleted successfully',
      })

      fetchUserFiles(
        viewingUser.id,
        userFiles.length === 1 ? Math.max(1, filePage - 1) : filePage
      )
    } catch (error) {
      console.error('Error deleting file:', error)
      toast({
        title: 'Error',
        description: 'Failed to delete file',
        variant: 'destructive',
      })
    }
  }

  const handleDeleteUrl = async (urlId: string) => {
    if (!viewingUser) return

    try {
      const response = await fetch(
        `/api/users/${viewingUser.id}/urls/${urlId}`,
        {
          method: 'DELETE',
        }
      )

      if (!response.ok) {
        throw new Error('Failed to delete URL')
      }

      toast({
        title: 'Success',
        description: 'URL deleted successfully',
      })

      fetchUserUrls(
        viewingUser.id,
        userUrls.length === 1 ? Math.max(1, urlPage - 1) : urlPage
      )
    } catch (error) {
      console.error('Error deleting URL:', error)
      toast({
        title: 'Error',
        description: 'Failed to delete URL',
        variant: 'destructive',
      })
    }
  }

  const handleFileSettings = async (
    visibility: 'PUBLIC' | 'PRIVATE',
    password?: string
  ) => {
    if (!viewingUser || !selectedFile) return

    try {
      const response = await fetch(
        `/api/users/${viewingUser.id}/files/${selectedFile.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility, password }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to update file settings')
      }

      toast({
        title: 'Success',
        description: 'File settings updated successfully',
      })

      fetchUserFiles(viewingUser.id, filePage)
    } catch (error) {
      console.error('Error updating file settings:', error)
      toast({
        title: 'Error',
        description: 'Failed to update file settings',
        variant: 'destructive',
      })
    }
  }

  const handleRemoveAvatar = async (userId: string) => {
    try {
      await removeUserAvatar(userId)
    } catch (error) {
      console.error('Error removing avatar:', error)
    }
  }

  const revokeSessions = async () => {
    if (!userToSignOut) return
    setSigningOut(true)
    try {
      const response = await fetch(`/api/users/${userToSignOut.id}/sessions`, {
        method: 'DELETE',
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Could not revoke sessions.')
      toast({
        title: 'Sessions revoked',
        description: `${userToSignOut.name} will need to sign in again.`,
      })
      setUserToSignOut(null)
    } catch (error) {
      toast({
        title: 'Could not revoke sessions',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSigningOut(false)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    try {
      await deleteUser(userId)
      setIsDeleteDialogOpen(false)
      setUserToDelete(null)
    } catch (error) {
      console.error('Error during user deletion process:', error)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-auto">
          <Search
            className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search users"
            placeholder="Search by name or email…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger aria-label="Filter users by role" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            {availableRoles
              .filter((role) => role.systemKey !== 'everyone')
              .map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <PermissionGate permission="users.create">
          <Button onClick={handleNew} className="ml-auto">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New User
          </Button>
        </PermissionGate>
      </div>
      <div className="flex min-h-8 items-center justify-between gap-3 text-sm text-muted-foreground">
        <p role="status">
          {loadError
            ? 'Users unavailable'
            : isLoading
              ? 'Loading users…'
              : `${pagination?.total ?? users.length} ${(pagination?.total ?? users.length) === 1 ? 'user' : 'users'}${query || role !== 'ALL' ? ' found' : ''}`}
        </p>
        {(search || role !== 'ALL') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              setQuery('')
              setRole('ALL')
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border bg-card px-4 py-8 text-center"
        >
          <p className="font-medium">Couldn’t load users</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => fetchUsers(currentPage)}
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : isLoading && users.length === 0 ? (
        <UserTableSkeleton />
      ) : users.length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-8 text-center">
          <p className="font-medium">No users found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try another name, email address, or role.
          </p>
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-xl border bg-card"
          aria-busy={isLoading}
        >
          <TooltipProvider>
            <Table className="table-fixed lg:table-auto" aria-label="Users">
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="pl-3 sm:pl-4">User</TableHead>
                  <TableHead className="hidden w-24 sm:table-cell lg:w-auto">
                    Roles
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">URL ID</TableHead>
                  <TableHead className="hidden lg:table-cell">Files</TableHead>
                  <TableHead className="hidden whitespace-nowrap lg:table-cell">
                    Storage Used
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">URLs</TableHead>
                  <TableHead className="w-[140px] pr-3 text-right sm:pr-4 lg:w-auto">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="py-3 pl-3 sm:pl-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="hidden h-8 w-8 shrink-0 sm:flex">
                          <AvatarImage src={user.image || undefined} alt="" />
                          <AvatarFallback>
                            {user.name
                              ?.split(' ')
                              .map((name) => name[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 lg:max-w-[240px] xl:max-w-sm">
                          <p className="truncate font-medium" title={user.name}>
                            {user.name}
                          </p>
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={user.email}
                          >
                            {user.email}
                          </p>
                          <div className="mt-1 space-y-1 text-xs text-muted-foreground lg:hidden">
                            <p className="sm:hidden">
                              <RoleBadges roles={user.roles} />
                            </p>
                            <p
                              className="truncate font-mono"
                              title={
                                user.vanityId
                                  ? `${user.urlId} / ${user.vanityId}`
                                  : user.urlId
                              }
                            >
                              {user.urlId}
                              {user.vanityId && ` / ${user.vanityId}`}
                            </p>
                            <p className="flex flex-wrap gap-x-2">
                              <span>{user._count.files} files</span>
                              <span>{formatFileSize(user.storageUsed)}</span>
                              <span>{user._count.shortenedUrls} URLs</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <RoleBadges roles={user.roles} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-col items-start gap-1">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {user.urlId}
                        </code>
                        {user.vanityId && (
                          <code
                            className="max-w-40 truncate rounded bg-primary/10 px-1.5 py-0.5 text-xs"
                            title={user.vanityId}
                          >
                            {user.vanityId}
                          </code>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden tabular-nums lg:table-cell">
                      {user._count.files}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap tabular-nums lg:table-cell">
                      {formatFileSize(user.storageUsed)}
                    </TableCell>
                    <TableCell className="hidden tabular-nums lg:table-cell">
                      {user._count.shortenedUrls}
                    </TableCell>
                    <TableCell className="pr-3 sm:pr-4">
                      <div className="flex justify-end gap-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={
                                !canManageUser(user) ||
                                (!can('users.update') &&
                                  !can('users.roles') &&
                                  !can('users.email'))
                              }
                              onClick={() => handleEdit(user)}
                              aria-label={`Edit ${user.name}`}
                            >
                              <Edit2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit User</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={!can('content.read')}
                              onClick={() => handleViewFiles(user)}
                              aria-label={`View content for ${user.name}`}
                            >
                              <FolderOpen
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View Content</TooltipContent>
                        </Tooltip>
                        {can('users.sessions') && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={!canManageUser(user)}
                                onClick={() => setUserToSignOut(user)}
                                aria-label={`Revoke sessions for ${user.name}`}
                              >
                                <LogOut
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Revoke Sessions</TooltipContent>
                          </Tooltip>
                        )}
                        {user.image && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={
                                  !can('users.update') || !canManageUser(user)
                                }
                                onClick={() => handleRemoveAvatar(user.id)}
                                aria-label={`Remove avatar for ${user.name}`}
                              >
                                <UserX className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Remove Avatar</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => {
                                setUserToDelete(user)
                                setIsDeleteDialogOpen(true)
                              }}
                              disabled={
                                !can('users.delete') || !canManageUser(user)
                              }
                              aria-label={`Delete ${user.name}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete User</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TooltipProvider>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'New User'}</DialogTitle>
            <DialogDescription>
              {editingUser
                ? 'Edit user details and permissions.'
                : 'Create a new user account.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Username</Label>
                <Input
                  id="name"
                  disabled={!!editingUser && !can('users.update')}
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="Username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  disabled={!!editingUser && !can('users.update')}
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder="email@example.com"
                  required
                />
              </div>
              {!editingUser && (
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    placeholder="••••••••"
                    required
                  />
                </div>
              )}
              {editingUser && (
                <div className="space-y-2">
                  <Label htmlFor="newPassword">
                    New Password
                    <span className="text-sm text-muted-foreground ml-2">
                      (Leave empty to keep current password)
                    </span>
                  </Label>
                  <Input
                    id="newPassword"
                    disabled={!!editingUser && !can('users.update')}
                    type="password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    placeholder="••••••••"
                  />
                </div>
              )}
              <fieldset disabled={!can('users.roles')} className="space-y-2">
                <legend className="text-sm font-medium">Roles</legend>
                <p className="text-xs text-muted-foreground">
                  Everyone applies automatically. Assigned roles add their
                  permissions together.
                </p>
                {roleLoadError && (
                  <p role="alert" className="text-sm text-destructive">
                    {roleLoadError}
                  </p>
                )}
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {availableRoles
                    .filter((role) => role.systemKey !== 'everyone')
                    .map((role) => (
                      <label
                        key={role.id}
                        className="flex items-center gap-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={formData.roleIds?.includes(role.id) ?? false}
                          disabled={
                            !can('administrator') &&
                            (role.position >= highestPosition ||
                              role.permissions.some(
                                (permission) =>
                                  !(
                                    actor?.permissions as
                                      readonly string[] | undefined
                                  )?.includes(permission)
                              ))
                          }
                          onChange={(event) =>
                            setFormData({
                              ...formData,
                              roleIds: event.target.checked
                                ? [...(formData.roleIds ?? []), role.id]
                                : (formData.roleIds ?? []).filter(
                                    (id) => id !== role.id
                                  ),
                            })
                          }
                        />
                        <RoleBadges roles={[role]} />
                      </label>
                    ))}
                </div>
                {!can('users.roles') && (
                  <p className="text-xs text-muted-foreground">
                    Your roles do not allow assigning roles.
                  </p>
                )}
              </fieldset>
              {editingUser && (
                <div className="space-y-2">
                  <Label htmlFor="urlId">
                    URL ID
                    <span className="text-sm text-muted-foreground ml-2">
                      (5 characters, alphanumeric)
                    </span>
                  </Label>
                  <Input
                    id="urlId"
                    disabled={!!editingUser && !can('users.update')}
                    value={formData.urlId || ''}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase()
                      if (/^[A-Z0-9]*$/.test(value) && value.length <= 5) {
                        setFormData({ ...formData, urlId: value })
                      }
                    }}
                    placeholder="e.g. ABC12"
                    maxLength={5}
                  />
                </div>
              )}
              {editingUser && (
                <div className="space-y-2">
                  <Label htmlFor="vanityId">
                    Vanity URL
                    <span className="text-sm text-muted-foreground ml-2">
                      (3-32 characters, optional)
                    </span>
                  </Label>
                  <Input
                    id="vanityId"
                    disabled={!!editingUser && !can('users.update')}
                    value={formData.vanityId || ''}
                    onChange={(e) => {
                      const value = e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, '')
                      if (value.length <= 32) {
                        setFormData({ ...formData, vanityId: value })
                      }
                    }}
                    placeholder="e.g. my-custom-url"
                    maxLength={32}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  isLoading ||
                  (Boolean(editingUser) &&
                    !can('users.update') &&
                    !can('users.roles'))
                }
              >
                {isLoading
                  ? 'Saving…'
                  : editingUser
                    ? 'Save Changes'
                    : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
          {editingUser && can('users.email') && (
            <UserEmailControls key={editingUser.id} userId={editingUser.id} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={isViewingFiles}
        onOpenChange={(open) => {
          setIsViewingFiles(open)
          if (!open) {
            filesRequest.current++
            urlsRequest.current++
            setViewingUser(null)
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewingUser?.name}&apos;s Content</DialogTitle>
            <DialogDescription>
              View and manage user&apos;s files and shortened URLs
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="files" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="files">
                Files ({filePagination?.total || 0})
              </TabsTrigger>
              <TabsTrigger value="urls">
                URLs ({urlPagination?.total || 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="files">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <div className="flex-1">
                    <Input
                      aria-label="Search this user’s files"
                      placeholder="Search files..."
                      value={fileFilters.search}
                      onChange={(e) =>
                        handleFileFilterChange({ search: e.target.value })
                      }
                      className="w-full"
                    />
                  </div>
                  <Select
                    value={fileFilters.visibility || 'all'}
                    onValueChange={(value) =>
                      handleFileFilterChange({
                        visibility:
                          value === 'all'
                            ? null
                            : (value as 'PUBLIC' | 'PRIVATE'),
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label="Filter user files by visibility"
                      className="w-full sm:w-[150px]"
                    >
                      <SelectValue placeholder="Visibility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="PUBLIC">Public</SelectItem>
                      <SelectItem value="PRIVATE">Private</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={fileFilters.type || 'all'}
                    onValueChange={(value) =>
                      handleFileFilterChange({
                        type: value === 'all' ? '' : value,
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label="Filter user files by type"
                      className="w-full sm:w-[150px]"
                    >
                      <SelectValue placeholder="File Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="image/">Images</SelectItem>
                      <SelectItem value="text/">Text</SelectItem>
                      <SelectItem value="application/">Documents</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]"></TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Visibility</TableHead>
                        <TableHead>Uploaded</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(filesLoading || userFiles.length === 0) && (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="h-28 text-center text-sm text-muted-foreground"
                          >
                            {filesLoading
                              ? 'Loading files…'
                              : 'No files match this view.'}
                          </TableCell>
                        </TableRow>
                      )}
                      {!filesLoading &&
                        userFiles.map((file: File) => (
                          <TableRow key={file.id}>
                            <TableCell className="w-[50px]">
                              <div className="flex items-center justify-center">
                                {getFilePreview(file)}
                              </div>
                            </TableCell>
                            <TableCell className="font-medium max-w-[300px]">
                              <div className="flex items-center justify-between gap-2">
                                <a
                                  href={sanitizeUrl(file.urlPath)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline flex items-center gap-2 truncate"
                                >
                                  {file.name}
                                </a>
                                <div className="flex-shrink-0">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Actions for ${file.name}`}
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        disabled={!can('content.update')}
                                        onClick={() => {
                                          setSelectedFile(file)
                                          setIsFileSettingsOpen(true)
                                        }}
                                      >
                                        <Lock className="h-4 w-4 mr-2" />
                                        Settings
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={!can('content.delete')}
                                        className="text-destructive"
                                        onClick={() => {
                                          setSelectedFile(file)
                                          setIsFileDeleteDialogOpen(true)
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[200px]">
                              <span
                                className="truncate block"
                                title={file.mimeType}
                              >
                                {file.mimeType}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {formatFileSize(file.size)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <span
                                className={cn(
                                  'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
                                  file.password
                                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-100'
                                    : file.visibility === 'PRIVATE'
                                      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-100'
                                      : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100'
                                )}
                              >
                                {file.password ? 'PROTECTED' : file.visibility}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {new Date(file.uploadedAt).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>

                {filePagination && filePagination.pages > 1 && (
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.preventDefault()
                            if (viewingUser) {
                              fetchUserFiles(viewingUser.id, filePage - 1)
                            }
                          }}
                          disabled={filePage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                      </PaginationItem>
                      {getPaginationRange(filePage, filePagination.pages).map(
                        (p) => (
                          <PaginationItem key={p}>
                            <PaginationLink
                              href="#"
                              onClick={(
                                e: React.MouseEvent<HTMLAnchorElement>
                              ) => {
                                e.preventDefault()
                                if (viewingUser) {
                                  fetchUserFiles(viewingUser.id, p)
                                }
                              }}
                              isActive={p === filePage}
                            >
                              {p}
                            </PaginationLink>
                          </PaginationItem>
                        )
                      )}
                      <PaginationItem>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.preventDefault()
                            if (viewingUser) {
                              fetchUserFiles(viewingUser.id, filePage + 1)
                            }
                          }}
                          disabled={filePage === filePagination.pages}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </div>
            </TabsContent>

            <TabsContent value="urls">
              <div className="space-y-4">
                <Input
                  aria-label="Search this user’s links"
                  placeholder="Search links..."
                  value={urlSearch}
                  onChange={(e) => handleUrlSearchChange(e.target.value)}
                  className="w-full"
                />

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Short URL</TableHead>
                        <TableHead>Target URL</TableHead>
                        <TableHead>Clicks</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(urlsLoading || userUrls.length === 0) && (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="h-28 text-center text-sm text-muted-foreground"
                          >
                            {urlsLoading
                              ? 'Loading links…'
                              : 'No links match this view.'}
                          </TableCell>
                        </TableRow>
                      )}
                      {!urlsLoading &&
                        userUrls.map((url) => (
                          <TableRow key={url.id}>
                            <TableCell className="font-medium">
                              <div className="flex items-center justify-between">
                                <a
                                  href={`/u/${url.shortCode}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline flex items-center gap-2"
                                >
                                  <Link2 className="h-4 w-4" />
                                  {url.shortCode}
                                </a>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Actions for ${url.shortCode}`}
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      disabled={!can('content.delete')}
                                      className="text-destructive"
                                      onClick={() => handleDeleteUrl(url.id)}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[300px] truncate">
                              <a
                                href={url.targetUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                              >
                                {url.targetUrl}
                              </a>
                            </TableCell>
                            <TableCell>{url.clicks}</TableCell>
                            <TableCell>
                              {new Date(url.createdAt).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>

                {urlPagination && urlPagination.pages > 1 && (
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.preventDefault()
                            if (viewingUser) {
                              fetchUserUrls(viewingUser.id, urlPage - 1)
                            }
                          }}
                          disabled={urlPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                      </PaginationItem>
                      {getPaginationRange(urlPage, urlPagination.pages).map(
                        (p) => (
                          <PaginationItem key={p}>
                            <PaginationLink
                              href="#"
                              onClick={(
                                e: React.MouseEvent<HTMLAnchorElement>
                              ) => {
                                e.preventDefault()
                                if (viewingUser) {
                                  fetchUserUrls(viewingUser.id, p)
                                }
                              }}
                              isActive={p === urlPage}
                            >
                              {p}
                            </PaginationLink>
                          </PaginationItem>
                        )
                      )}
                      <PaginationItem>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.preventDefault()
                            if (viewingUser) {
                              fetchUserUrls(viewingUser.id, urlPage + 1)
                            }
                          }}
                          disabled={urlPage === urlPagination.pages}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <FileSettingsDialog
        file={selectedFile}
        isOpen={isFileSettingsOpen}
        onClose={() => {
          setSelectedFile(null)
          setIsFileSettingsOpen(false)
        }}
        onSave={handleFileSettings}
      />

      <AlertDialog
        open={isFileDeleteDialogOpen}
        onOpenChange={setIsFileDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedFile?.name}? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setSelectedFile(null)
                setIsFileDeleteDialogOpen(false)
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (selectedFile) {
                  handleDeleteFile(selectedFile.id)
                }
                setSelectedFile(null)
                setIsFileDeleteDialogOpen(false)
              }}
            >
              Delete File
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {userToDelete?.name}? This action
              cannot be undone. All of their files and data will be permanently
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setUserToDelete(null)
                setIsDeleteDialogOpen(false)
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (userToDelete) {
                  handleDeleteUser(userToDelete.id)
                }
              }}
            >
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(userToSignOut)}
        onOpenChange={(open) => {
          if (!open && !signingOut) setUserToSignOut(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out {userToSignOut?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Revoke every browser session for this account. They can sign in
              again with their existing credentials. Their API tokens are
              unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={signingOut}
              onClick={(event) => {
                event.preventDefault()
                void revokeSessions()
              }}
            >
              {signingOut ? 'Revoking…' : 'Revoke sessions'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {pagination && pagination.pages > 1 && (
        <div className="flex justify-center">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.preventDefault()
                    fetchUsers(currentPage - 1)
                  }}
                  aria-label="Previous users page"
                  disabled={currentPage === 1 || isLoading}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </PaginationItem>
              {getPaginationRange(currentPage, pagination.pages).map((p) => (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                      e.preventDefault()
                      fetchUsers(p)
                    }}
                    isActive={p === currentPage}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.preventDefault()
                    fetchUsers(currentPage + 1)
                  }}
                  aria-label="Next users page"
                  disabled={currentPage === pagination.pages || isLoading}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  )
}
