import type { ToolDefinition } from '../tool'
import { accountTools } from './account'
import { archivesTools } from './archives'
import { fileTools } from './files'
import { foldersTools } from './folders'
import { instanceTools } from './instance'
import { invitesTools } from './invites'
import { linksTools } from './links'
import { organizeTools } from './organize'
import { profileTools } from './profile'
import { rolesTools } from './roles'
import { tagsTools } from './tags'
import { uploadProfileTools } from './upload-profiles'
import { uploadsTools } from './uploads'
import { usersTools } from './users'

/**
 * Every tool's definition. `TOOL_CATALOG` decides who may call each one and
 * the order clients list them in; a test holds the two lists together.
 */
export const TOOLS: ToolDefinition[] = [
  ...accountTools,
  ...fileTools,
  ...foldersTools,
  ...tagsTools,
  ...linksTools,
  ...uploadsTools,
  ...organizeTools,
  ...archivesTools,
  ...profileTools,
  ...uploadProfileTools,
  ...invitesTools,
  ...usersTools,
  ...rolesTools,
  ...instanceTools,
] as ToolDefinition[]
