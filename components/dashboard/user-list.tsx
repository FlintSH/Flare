'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import Image from 'next/image'
import { useRouter } from 'next/navigation'

import {
  ChevronLeft,
  ChevronRight,
  Edit2,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  KeyRound,
  Link2,
  Lock,
  LogOut,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserX,
} from 'lucide-react'
import { useSession } from 'next-auth/react'

import { UserEmailControls } from '@/components/email/user-email-controls'
import {
  FilePasswordHint,
  filePasswordFieldProps,
} from '@/components/file/file-password-hint'
import { FileTypeIcon } from '@/components/file/file-type-icon'
import { PermissionGate } from '@/components/roles/permission-gate'
import { RoleBadges, RoleChecklist } from '@/components/roles/role-badges'
import {
  destructiveActionClassName,
  formDialogBodyClassName,
  formDialogClassName,
  formDialogFooterClassName,
} from '@/components/shared/form-styles'
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
import { Badge } from '@/components/ui/badge'
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
import { Switch } from '@/components/ui/switch'
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

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import type { AccountFile, FileSettings } from '@/lib/files/manage'
import { filePasswordHint } from '@/lib/files/password-policy'
import { fileUrls } from '@/lib/files/urls'
import {
  type AccountShortLink,
  type AccountShortLinkPage,
  shortLinkUrl,
} from '@/lib/links/schema'
import { resolvePermissions } from '@/lib/permissions/catalog'
import {
  canGrantRole,
  isEveryoneRole,
  userManagementRefusal,
} from '@/lib/permissions/policy'
import { ACCOUNT_PASSWORD_MIN_LENGTH } from '@/lib/users/account-policy'
import {
  URL_ID_LENGTH,
  VANITY_ID_MAX_LENGTH,
  VANITY_ID_MIN_LENGTH,
  isUrlIdDraft,
  vanityIdDraft,
} from '@/lib/users/public-id'
import { cn, formatFileSize } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { usePermissions } from '@/hooks/use-permissions'
import { useRoles } from '@/hooks/use-roles'
import { useToast } from '@/hooks/use-toast'
import {
  type PaginationData,
  type User,
  UserFormData,
  useUserManagement,
} from '@/hooks/use-user-management'

interface FileFilters {
  search: string
  visibility: 'PUBLIC' | 'PRIVATE' | null
  type: string
}

interface FileResponse {
  files: AccountFile[]
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
            <TableHead className="hidden text-right lg:table-cell">
              Files
            </TableHead>
            <TableHead className="hidden text-right lg:table-cell">
              Storage used
            </TableHead>
            <TableHead className="hidden text-right lg:table-cell">
              URLs
            </TableHead>
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
                <Skeleton className="ml-auto h-4 w-8" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="ml-auto h-4 w-16" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="ml-auto h-4 w-8" />
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

/** "1 file", "6 files", kept on one line (a no-break space). */
function countOf(value: number, noun: string) {
  return `${value.toLocaleString()}\u00a0${value === 1 ? noun : `${noun}s`}`
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

function VisibilityBadge({
  file,
  className,
}: {
  file: Pick<AccountFile, 'visibility'>
  className?: string
}) {
  const isProtected = file.visibility === 'PROTECTED'
  const Icon = isProtected
    ? KeyRound
    : file.visibility === 'PRIVATE'
      ? Lock
      : Globe
  // Private files are what a moderator scans for, so they take the amber
  // status tone; public and password ones stay neutral.
  const isPrivate = file.visibility === 'PRIVATE'
  return (
    <Badge variant={isPrivate ? 'warning' : 'neutral'} className={className}>
      <Icon aria-hidden="true" />
      {isProtected ? 'Password' : isPrivate ? 'Private' : 'Public'}
    </Badge>
  )
}

/** `KEEP` sends no visibility. */
type VisibilityChoice = NonNullable<FileSettings['visibility']> | 'KEEP'

interface FileSettingsForm {
  visibility: VisibilityChoice
  /** A new password; empty keeps the current one. */
  password: string
  removePassword: boolean
}

/**
 * Where the dialog starts. The list doesn't say which visibility a
 * password-protected file has, so its dialog starts from keeping it.
 */
export function fileSettingsForm(
  file: Pick<AccountFile, 'visibility'>
): FileSettingsForm {
  return {
    visibility: file.visibility === 'PROTECTED' ? 'KEEP' : file.visibility,
    password: '',
    removePassword: false,
  }
}

/** What saving the dialog sends: only what it changes. */
export function fileSettingsChanges(
  file: Pick<AccountFile, 'visibility'>,
  form: FileSettingsForm
): FileSettings {
  return {
    ...(form.visibility !== 'KEEP' && form.visibility !== file.visibility
      ? { visibility: form.visibility }
      : {}),
    ...(form.removePassword
      ? { password: null }
      : form.password
        ? { password: form.password }
        : {}),
  }
}

interface FileSettingsDialogProps {
  file: AccountFile | null
  isOpen: boolean
  onClose: () => void
  onSave: (changes: FileSettings) => Promise<void>
}

export function FileSettingsDialog({
  file,
  isOpen,
  onClose,
  onSave,
}: FileSettingsDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File settings</DialogTitle>
          <DialogDescription className="break-words">
            Update visibility and password protection for{' '}
            <span className="font-medium text-foreground">{file?.name}</span>.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while the dialog is open, so each opening starts
            from the file. */}
        {file && (
          <FileSettingsFields
            key={file.id}
            file={file}
            onClose={onClose}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function FileSettingsFields({
  file,
  onClose,
  onSave,
}: Omit<FileSettingsDialogProps, 'file' | 'isOpen'> & { file: AccountFile }) {
  const [form, setForm] = useState(() => fileSettingsForm(file))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { visibility, password, removePassword } = form
  const isProtected = file.visibility === 'PROTECTED'
  const changes = fileSettingsChanges(file, form)
  const canSave =
    Object.keys(changes).length > 0 && !(password && filePasswordHint(password))
  const edit = (change: Partial<FileSettingsForm>) =>
    setForm({ ...form, ...change })

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSave) return
    setIsSubmitting(true)
    try {
      await onSave(changes)
      onClose()
    } catch (error) {
      console.error('Error saving file settings:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="visibility">Visibility</Label>
          <Select
            value={visibility}
            onValueChange={(value: VisibilityChoice) =>
              edit({ visibility: value })
            }
          >
            <SelectTrigger id="visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isProtected && (
                <SelectItem value="KEEP">Keep current visibility</SelectItem>
              )}
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
          <Label htmlFor="password-protection">
            {isProtected ? 'New password' : 'Password protection'}
          </Label>
          <Input
            id="password-protection"
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={removePassword}
            onChange={(e) => edit({ password: e.target.value })}
            placeholder={
              removePassword
                ? 'The password is removed when you save'
                : isProtected
                  ? 'Leave empty to keep the current password'
                  : 'Leave empty for no password'
            }
            {...filePasswordFieldProps('password-protection-hint', password)}
          />
          <FilePasswordHint id="password-protection-hint" password={password} />
          {isProtected && (
            <div className="flex items-center justify-between gap-4 pt-1">
              <Label htmlFor="remove-password">Remove password</Label>
              <Switch
                id="remove-password"
                checked={removePassword}
                onCheckedChange={(checked) =>
                  edit({ removePassword: checked, password: '' })
                }
              />
            </div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !canSave}>
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function UserList() {
  const router = useRouter()
  const { update: refreshSession } = useSession()
  const { can, user: actor } = usePermissions()
  const roles = useRoles({ retry: false })
  const availableRoles = roles.data?.roles ?? []
  const roleLoadError = roles.error?.message ?? ''
  const canManageUser = (target: User) =>
    !userManagementRefusal(actor, {
      ...target,
      permissions: resolvePermissions(target.roles),
    })
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
  const [userFiles, setUserFiles] = useState<AccountFile[]>([])
  const [userUrls, setUserUrls] = useState<AccountShortLink[]>([])
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
  const [selectedFile, setSelectedFile] = useState<AccountFile | null>(null)
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

        const data = await apiRequest<FileResponse>(
          `/api/users/${userId}/files?${params}`
        )
        if (requestId !== filesRequest.current) return
        setUserFiles(data.files)
        setFilePagination(data.pagination)
        // A page past the end comes back as the last page.
        setFilePage(data.pagination.page)
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

        const data = await apiRequest<AccountShortLinkPage>(
          `/api/users/${userId}/urls?${params}`
        )
        if (requestId !== urlsRequest.current) return
        setUserUrls(data.urls)
        setUrlPagination(data.pagination)
        setUrlPage(data.pagination.page)
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
        }
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
        .filter((role) => !isEveryoneRole(role))
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

  // A hairline keeps light screenshots from dissolving into the row.
  const getFilePreview = (file: AccountFile) => {
    if (file.mimeType.startsWith('image/')) {
      return (
        <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          <Image
            src={fileUrls(file).thumbnail}
            alt={file.name}
            fill
            className="object-cover"
            sizes="40px"
            priority={false}
            loading="lazy"
            // Moderation previews need this browser's session for file access.
            unoptimized
          />
        </div>
      )
    }
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
        <FileTypeIcon file={file} className="h-4 w-4" />
      </div>
    )
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!viewingUser) return

    try {
      await apiRequest(`/api/users/${viewingUser.id}/files/${fileId}`, {
        method: 'DELETE',
        fallback: 'Failed to delete file',
      })

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
        description:
          error instanceof RefusedRequest
            ? error.message
            : 'Failed to delete file',
        variant: 'destructive',
      })
    }
  }

  const handleDeleteUrl = async (urlId: string) => {
    if (!viewingUser) return

    try {
      await apiRequest(`/api/users/${viewingUser.id}/urls/${urlId}`, {
        method: 'DELETE',
        fallback: 'Failed to delete URL',
      })

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
        description:
          error instanceof RefusedRequest
            ? error.message
            : 'Failed to delete URL',
        variant: 'destructive',
      })
    }
  }

  const handleFileSettings = async (changes: FileSettings) => {
    if (!viewingUser || !selectedFile) return

    try {
      await apiRequest(
        `/api/users/${viewingUser.id}/files/${selectedFile.id}`,
        {
          method: 'PATCH',
          body: changes,
          fallback: 'Failed to update file settings',
        }
      )

      toast({
        title: 'Success',
        description: 'File settings updated successfully',
      })

      fetchUserFiles(viewingUser.id, filePage)
    } catch (error) {
      console.error('Error updating file settings:', error)
      toast({
        title: 'Error',
        description:
          error instanceof RefusedRequest
            ? error.message
            : 'Failed to update file settings',
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
      await apiRequest(`/api/users/${userToSignOut.id}/sessions`, {
        method: 'DELETE',
        fallback: 'Could not revoke sessions.',
      })
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
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
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
              .filter((role) => !isEveryoneRole(role))
              .map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <PermissionGate permission="users.create">
          <Button onClick={handleNew} className="ml-auto">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New user
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
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
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
                  <TableHead className="hidden w-32 sm:table-cell lg:w-auto">
                    Roles
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">URL ID</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">
                    Files
                  </TableHead>
                  <TableHead className="hidden whitespace-nowrap text-right lg:table-cell">
                    Storage used
                  </TableHead>
                  <TableHead className="hidden text-right lg:table-cell">
                    URLs
                  </TableHead>
                  <TableHead className="w-[140px] pr-3 text-right sm:w-[184px] sm:pr-4 lg:w-auto">
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
                          {user.invitedBy && (
                            <p className="truncate text-xs text-muted-foreground">
                              Invited by {user.invitedBy.name || 'an account'}
                            </p>
                          )}
                          <div className="mt-1 space-y-1 text-xs text-muted-foreground lg:hidden">
                            <p className="sm:hidden">
                              <RoleBadges roles={user.roles} />
                            </p>
                            <p className="flex min-w-0 flex-wrap items-center gap-1 text-foreground">
                              <code className="rounded bg-muted px-1.5 py-0.5">
                                {user.urlId}
                              </code>
                              {user.vanityId && (
                                <code
                                  className="max-w-full truncate rounded bg-primary/10 px-1.5 py-0.5"
                                  title={user.vanityId}
                                >
                                  {user.vanityId}
                                </code>
                              )}
                            </p>
                            {/* Each separator wraps with the item after it,
                                so no line ends in one. */}
                            <p className="tabular-nums">
                              {countOf(user._count.files, 'file')}{' '}
                              <span className="whitespace-nowrap">
                                · {formatFileSize(user.storageUsed)}
                              </span>{' '}
                              <span className="whitespace-nowrap">
                                · {countOf(user._count.shortenedUrls, 'URL')}
                              </span>
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
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {user._count.files.toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right tabular-nums lg:table-cell">
                      {formatFileSize(user.storageUsed)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {user._count.shortenedUrls.toLocaleString()}
                    </TableCell>
                    <TableCell className="pr-3 sm:pr-4">
                      {/* One row of icons in steady columns. Phones keep
                          edit, content and delete in view and move the rarer
                          session and avatar actions into a menu. The negative
                          margin lines the last icon up with the header. */}
                      <div className="-mr-2 flex justify-end sm:gap-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
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
                          <TooltipContent>Edit user</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
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
                          <TooltipContent>View content</TooltipContent>
                        </Tooltip>
                        {can('users.sessions') || user.image ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 sm:hidden"
                                aria-label={`More actions for ${user.name}`}
                              >
                                <MoreVertical
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {can('users.sessions') && (
                                <DropdownMenuItem
                                  disabled={!canManageUser(user)}
                                  onSelect={() => setUserToSignOut(user)}
                                >
                                  <LogOut aria-hidden="true" />
                                  Revoke sessions
                                </DropdownMenuItem>
                              )}
                              {user.image && (
                                <DropdownMenuItem
                                  disabled={
                                    !can('users.update') || !canManageUser(user)
                                  }
                                  onSelect={() => handleRemoveAvatar(user.id)}
                                >
                                  <UserX aria-hidden="true" />
                                  Remove avatar
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span
                            className="h-8 w-8 shrink-0 sm:hidden"
                            aria-hidden="true"
                          />
                        )}
                        {can('users.sessions') && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="hidden h-8 w-8 shrink-0 sm:inline-flex"
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
                            <TooltipContent>Revoke sessions</TooltipContent>
                          </Tooltip>
                        )}
                        {user.image ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="hidden h-8 w-8 shrink-0 sm:inline-flex"
                                disabled={
                                  !can('users.update') || !canManageUser(user)
                                }
                                onClick={() => handleRemoveAvatar(user.id)}
                                aria-label={`Remove avatar for ${user.name}`}
                              >
                                <UserX className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Remove avatar</TooltipContent>
                          </Tooltip>
                        ) : (
                          // Keeps the action icons in columns across rows.
                          <span
                            className="hidden h-8 w-8 shrink-0 sm:block"
                            aria-hidden="true"
                          />
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-destructive hover:bg-danger/10 hover:text-destructive"
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
                          <TooltipContent>Delete user</TooltipContent>
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
        {/* The form can be taller than a phone screen, so the fields scroll
            between the title and the actions, which stay in view below a
            hairline. The scrolling edge fades while there is more. */}
        <DialogContent className={formDialogClassName}>
          <DialogHeader className="shrink-0">
            <DialogTitle>{editingUser ? 'Edit user' : 'New user'}</DialogTitle>
            <DialogDescription>
              {editingUser
                ? 'Edit user details and permissions.'
                : 'Create a new user account.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div ref={scrollFadeRef} className={formDialogBodyClassName}>
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Username</Label>
                  <Input
                    id="name"
                    disabled={!!editingUser && !can('users.update')}
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Their name or handle"
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
                    placeholder="name@example.com"
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
                      placeholder={`At least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters`}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                )}
                {editingUser && (
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">
                      New password{' '}
                      <span className="font-normal text-muted-foreground">
                        (optional)
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
                      placeholder={`At least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters`}
                      autoComplete="new-password"
                      aria-describedby="newPassword-help"
                    />
                    <p
                      id="newPassword-help"
                      className="text-xs text-muted-foreground"
                    >
                      Leave empty to keep the current password.
                    </p>
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
                  <RoleChecklist
                    roles={availableRoles.filter(
                      (role) => !isEveryoneRole(role)
                    )}
                    selected={formData.roleIds ?? []}
                    onChange={(roleIds) =>
                      setFormData({ ...formData, roleIds })
                    }
                    isDisabled={(role) => !canGrantRole(actor, role)}
                  />
                  {!can('users.roles') && (
                    <p className="text-xs text-muted-foreground">
                      Your roles do not allow assigning roles.
                    </p>
                  )}
                </fieldset>
                {editingUser && (
                  <div className="space-y-2">
                    <Label htmlFor="urlId">URL ID</Label>
                    <Input
                      id="urlId"
                      spellCheck={false}
                      disabled={!!editingUser && !can('users.update')}
                      value={formData.urlId || ''}
                      onChange={(e) => {
                        // File URLs use the ID as written, so case stays as typed.
                        if (isUrlIdDraft(e.target.value))
                          setFormData({ ...formData, urlId: e.target.value })
                      }}
                      placeholder="e.g. ABC12"
                      maxLength={URL_ID_LENGTH}
                      aria-describedby="urlId-help"
                    />
                    <p
                      id="urlId-help"
                      className="text-xs text-muted-foreground"
                    >
                      Exactly {URL_ID_LENGTH} letters or numbers.
                    </p>
                  </div>
                )}
                {editingUser && (
                  <div className="space-y-2">
                    <Label htmlFor="vanityId">
                      Vanity URL{' '}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="vanityId"
                      spellCheck={false}
                      disabled={!!editingUser && !can('users.update')}
                      value={formData.vanityId || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          vanityId: vanityIdDraft(e.target.value),
                        })
                      }
                      placeholder="e.g. my-custom-url"
                      maxLength={VANITY_ID_MAX_LENGTH}
                      aria-describedby="vanityId-help"
                    />
                    <p
                      id="vanityId-help"
                      className="text-xs text-muted-foreground"
                    >
                      {VANITY_ID_MIN_LENGTH}–{VANITY_ID_MAX_LENGTH} letters,
                      numbers or inner hyphens.
                    </p>
                  </div>
                )}
              </div>
              {editingUser && can('users.email') && (
                <UserEmailControls
                  key={editingUser.id}
                  userId={editingUser.id}
                />
              )}
            </div>
            <DialogFooter className={formDialogFooterClassName}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                Cancel
              </Button>
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
                    ? 'Save changes'
                    : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
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
        <DialogContent className={cn(formDialogClassName, 'max-w-4xl')}>
          <DialogHeader className="shrink-0">
            <DialogTitle>{viewingUser?.name}&apos;s content</DialogTitle>
            <DialogDescription>
              View and manage this user&apos;s files and shortened URLs.
            </DialogDescription>
          </DialogHeader>

          {/* The tables scroll under the title, with a fade while more
              rows follow. */}
          <div ref={scrollFadeRef} className={formDialogBodyClassName}>
            <Tabs defaultValue="files" className="w-full">
              <TabsList className="grid w-full grid-cols-2 sm:inline-grid sm:w-auto">
                <TabsTrigger value="files">
                  Files ({filePagination?.total || 0})
                </TabsTrigger>
                <TabsTrigger value="urls">
                  URLs ({urlPagination?.total || 0})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="files" tabIndex={-1}>
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-3">
                    <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        aria-label="Search this user’s files"
                        placeholder="Search files…"
                        value={fileFilters.search}
                        onChange={(e) =>
                          handleFileFilterChange({ search: e.target.value })
                        }
                        className="pl-9"
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
                        className="min-w-0 flex-1 sm:w-40 sm:flex-none"
                      >
                        <SelectValue placeholder="Any visibility" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Any visibility</SelectItem>
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
                        className="min-w-0 flex-1 sm:w-40 sm:flex-none"
                      >
                        <SelectValue placeholder="All file types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All file types</SelectItem>
                        <SelectItem value="image/">Images</SelectItem>
                        <SelectItem value="text/">Text</SelectItem>
                        <SelectItem value="application/">Documents</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="overflow-hidden rounded-xl border">
                    {/* Columns drop away on narrow screens; their details move
                      under the name and the menu stays on the right. */}
                    <Table
                      className="table-fixed"
                      aria-label={`Files uploaded by ${viewingUser?.name ?? 'this user'}`}
                    >
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="w-14">
                            <span className="sr-only">Preview</span>
                          </TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead className="hidden w-32 lg:table-cell">
                            Type
                          </TableHead>
                          <TableHead className="hidden w-[6.5rem] sm:table-cell">
                            Visibility
                          </TableHead>
                          <TableHead className="hidden w-24 text-right sm:table-cell">
                            Size
                          </TableHead>
                          <TableHead className="hidden w-24 text-right md:table-cell">
                            Uploaded
                          </TableHead>
                          <TableHead className="w-12 px-2 text-center sm:w-20">
                            <span className="sr-only sm:not-sr-only">
                              Actions
                            </span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!filesLoading &&
                          userFiles.map((file) => {
                            const uploaded = new Date(
                              file.uploadedAt
                            ).toLocaleDateString()
                            return (
                              <TableRow key={file.id}>
                                <TableCell>{getFilePreview(file)}</TableCell>
                                <TableCell className="py-3">
                                  <a
                                    href={fileUrls(file).page}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={file.name}
                                    className="block truncate rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    {file.name}
                                  </a>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
                                    <VisibilityBadge
                                      file={file}
                                      className="sm:hidden"
                                    />
                                    <span className="tabular-nums">
                                      <span className="sm:hidden">
                                        {formatFileSize(file.size)} ·{' '}
                                      </span>
                                      {uploaded}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                  <span
                                    className="block truncate"
                                    title={file.mimeType}
                                  >
                                    {file.mimeType}
                                  </span>
                                </TableCell>
                                <TableCell className="hidden sm:table-cell">
                                  <VisibilityBadge file={file} />
                                </TableCell>
                                <TableCell className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
                                  {formatFileSize(file.size)}
                                </TableCell>
                                <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground md:table-cell">
                                  {uploaded}
                                </TableCell>
                                <TableCell className="px-2 text-center">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
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
                                        <Lock className="h-4 w-4" />
                                        Settings
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={!can('content.delete')}
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => {
                                          setSelectedFile(file)
                                          setIsFileDeleteDialogOpen(true)
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                      </TableBody>
                    </Table>
                    {/* Outside the table: a spanning cell would upset the
                      fixed column widths when columns are hidden. */}
                    {(filesLoading || userFiles.length === 0) && (
                      <p
                        role="status"
                        className="grid h-28 place-items-center px-4 text-center text-sm text-muted-foreground"
                      >
                        {filesLoading
                          ? 'Loading files…'
                          : 'No files match this view.'}
                      </p>
                    )}
                  </div>

                  {filePagination && filePagination.pages > 1 && (
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Previous files page"
                            onClick={(
                              e: React.MouseEvent<HTMLButtonElement>
                            ) => {
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
                            aria-label="Next files page"
                            onClick={(
                              e: React.MouseEvent<HTMLButtonElement>
                            ) => {
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

              <TabsContent value="urls" tabIndex={-1}>
                <div className="space-y-4">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      aria-label="Search this user’s links"
                      placeholder="Search links…"
                      value={urlSearch}
                      onChange={(e) => handleUrlSearchChange(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  <div className="overflow-hidden rounded-xl border">
                    <Table
                      className="table-fixed"
                      aria-label={`Short links created by ${viewingUser?.name ?? 'this user'}`}
                    >
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="pl-4 sm:w-40">
                            Short URL
                          </TableHead>
                          <TableHead className="hidden sm:table-cell">
                            Target URL
                          </TableHead>
                          <TableHead className="hidden w-20 text-right sm:table-cell">
                            Clicks
                          </TableHead>
                          <TableHead className="hidden w-28 text-right md:table-cell">
                            Created
                          </TableHead>
                          <TableHead className="w-12 px-2 text-center sm:w-20">
                            <span className="sr-only sm:not-sr-only">
                              Actions
                            </span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!urlsLoading &&
                          userUrls.map((url) => {
                            const created = new Date(
                              url.createdAt
                            ).toLocaleDateString()
                            return (
                              <TableRow key={url.id}>
                                <TableCell className="py-3 pl-4">
                                  <a
                                    href={shortLinkUrl(url.shortCode)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex max-w-full items-center gap-2 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    <Link2
                                      className="h-4 w-4 shrink-0 text-muted-foreground"
                                      aria-hidden="true"
                                    />
                                    <span className="truncate">
                                      {url.shortCode}
                                    </span>
                                  </a>
                                  <div className="mt-1 space-y-0.5 text-xs text-muted-foreground md:hidden">
                                    <a
                                      href={url.targetUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={url.targetUrl}
                                      className="block truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
                                    >
                                      {url.targetUrl}
                                    </a>
                                    {/* Breaks only between the two facts. */}
                                    <p>
                                      <span className="whitespace-nowrap tabular-nums sm:hidden">
                                        {countOf(url.clicks, 'click')} ·
                                      </span>{' '}
                                      <span className="whitespace-nowrap">
                                        Created {created}
                                      </span>
                                    </p>
                                  </div>
                                </TableCell>
                                <TableCell className="hidden sm:table-cell">
                                  <a
                                    href={url.targetUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={url.targetUrl}
                                    className="block truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    {url.targetUrl}
                                  </a>
                                </TableCell>
                                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                                  {url.clicks.toLocaleString()}
                                </TableCell>
                                <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground md:table-cell">
                                  {created}
                                </TableCell>
                                <TableCell className="px-2 text-center">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        aria-label={`Actions for ${url.shortCode}`}
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        disabled={!can('content.delete')}
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => handleDeleteUrl(url.id)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                      </TableBody>
                    </Table>
                    {(urlsLoading || userUrls.length === 0) && (
                      <p
                        role="status"
                        className="grid h-28 place-items-center px-4 text-center text-sm text-muted-foreground"
                      >
                        {urlsLoading
                          ? 'Loading links…'
                          : 'No links match this view.'}
                      </p>
                    )}
                  </div>

                  {urlPagination && urlPagination.pages > 1 && (
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Previous links page"
                            onClick={(
                              e: React.MouseEvent<HTMLButtonElement>
                            ) => {
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
                            aria-label="Next links page"
                            onClick={(
                              e: React.MouseEvent<HTMLButtonElement>
                            ) => {
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
          </div>
        </DialogContent>
      </Dialog>

      <FileSettingsDialog
        file={selectedFile}
        isOpen={isFileSettingsOpen}
        // The file stays selected, so the dialog doesn't change as it closes.
        onClose={() => setIsFileSettingsOpen(false)}
        onSave={handleFileSettings}
      />

      <AlertDialog
        open={isFileDeleteDialogOpen}
        onOpenChange={setIsFileDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                {selectedFile?.name}
              </span>
              ? This action cannot be undone.
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
              className={destructiveActionClassName}
              onClick={() => {
                if (selectedFile) {
                  handleDeleteFile(selectedFile.id)
                }
                setSelectedFile(null)
                setIsFileDeleteDialogOpen(false)
              }}
            >
              Delete file
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
            <AlertDialogTitle>Delete user</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                {userToDelete?.name}
              </span>
              ? This action cannot be undone. All of their files and data will
              be permanently deleted.
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
              className={destructiveActionClassName}
              onClick={() => {
                if (userToDelete) {
                  handleDeleteUser(userToDelete.id)
                }
              }}
            >
              Delete user
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
