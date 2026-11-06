/**
 * What each action on files, folders and archives needs, read by the API and
 * the dashboard so both apply one rule. An action that calls an account route
 * needs what the bearer route table grants that route. No server imports.
 */
import { ExpiryAction } from '@/types/events'

import { requestPermissions } from '@/lib/integrations/bearer-routes'

import {
  type Permission,
  type PermissionSubject,
  hasPermission,
} from './catalog'

function routeNeeds(method: string, path: string): readonly Permission[] {
  const permissions = requestPermissions(method, path)
  if (!permissions) throw new Error(`${method} ${path} is not an account route`)
  return permissions
}

const viewFiles = routeNeeds('GET', '/api/files')
const uploadFiles = routeNeeds('POST', '/api/files')
const fileIntoFolder = ['folders.manage'] as const

export const ACTION_PERMISSIONS = {
  /** List and open your files, and browse inside an archive. */
  viewFiles,
  uploadFiles,
  /** Copy a file's link, change its visibility, or set its password. */
  shareFiles: ['files.share'],
  deleteFiles: ['files.delete'],
  /** Open Manage expiration and remove an expiration. */
  manageExpiration: routeNeeds('POST', '/api/files/{id}/expiry'),
  moveFiles: routeNeeds('POST', '/api/files/folders'),
  tagFiles: routeNeeds('PATCH', '/api/files/tags'),
  /** Create, rename and remove folders. */
  manageFolders: routeNeeds('POST', '/api/folders'),
  /**
   * Create or disable a folder link. Its route checks `folders.share` on top
   * of what changing a folder needs.
   */
  shareFolders: [...routeNeeds('PATCH', '/api/folders/{id}'), 'folders.share'],
  /** Apply a tag's rule to the files already uploaded. */
  applyTagRule: routeNeeds('POST', '/api/tags/{id}/apply'),
  /** Save new files into a folder: an upload's, an archive's or an extraction's. */
  fileIntoFolder,
  createArchive: [...viewFiles, ...uploadFiles],
  /** Extraction always saves into a new folder. */
  extractArchive: [...viewFiles, ...uploadFiles, ...fileIntoFolder],
} as const satisfies Record<string, readonly Permission[]>

export type Action = keyof typeof ACTION_PERMISSIONS

/** Scheduling an expiration also needs what it does when it runs. */
export const EXPIRY_EFFECTS = {
  [ExpiryAction.DELETE]: 'deleteFiles',
  [ExpiryAction.SET_PRIVATE]: 'shareFiles',
} as const satisfies Record<ExpiryAction, Action>

/** The permissions the actions need together, in the order servers check them. */
export function actionPermissions(
  actions: Action | readonly Action[]
): Permission[] {
  return [
    ...new Set(
      (typeof actions === 'string' ? [actions] : actions).flatMap(
        (action) => ACTION_PERMISSIONS[action]
      )
    ),
  ]
}

/** Whether the subject may take every one of the actions. */
export function allows(
  subject: PermissionSubject | null | undefined,
  actions: Action | readonly Action[]
): boolean {
  return actionPermissions(actions).every((permission) =>
    hasPermission(subject, permission)
  )
}
