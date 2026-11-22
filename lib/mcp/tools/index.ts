import type { ToolDefinition } from '../tool'
import { accountTools } from './account'
import { archivesTools } from './archives'
import { fileTools } from './files'
import { foldersTools } from './folders'
import { linksTools } from './links'
import { organizeTools } from './organize'
import { profileTools } from './profile'
import { tagsTools } from './tags'
import { uploadProfileTools } from './upload-profiles'
import { uploadsTools } from './uploads'

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
] as ToolDefinition[]
