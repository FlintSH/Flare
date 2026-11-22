import * as z from 'zod'

import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getBuildInfo } from '@/lib/releases'
import { storageQuotaBytes, uploadCapacity } from '@/lib/uploads/capacity'
import { mbToBytes } from '@/lib/utils/size'

import { TOOL_NAMES, toolAllowed } from '../catalog'
import { compact } from '../results'
import { defineTool } from '../tool'

const getAccount = defineTool({
  name: 'get_account',
  description:
    'Who this connection acts as in Flare and what it may do: the account, the scopes and tools this connection has, storage used and quota, the largest file it may upload, and the upload profiles it can name when uploading. Call it first.',
  input: z.object({}),
  output: z.object({
    account: z.object({
      id: z.string(),
      name: z.string().optional(),
      roles: z.array(z.string()),
    }),
    instance: z.object({
      url: z.string(),
      version: z.string(),
    }),
    connection: z.object({
      scopes: z.array(z.string()),
      tools: z.array(z.string()),
      upload_profile: z
        .object({ id: z.string(), name: z.string().optional() })
        .optional()
        .describe(
          'Set when this token is bound to one upload profile: every upload uses it, and no other profile or setting it fixes can be chosen'
        ),
    }),
    storage: z
      .object({
        used_bytes: z.number(),
        quota_bytes: z.number().optional().describe('Absent without a quota'),
      })
      .optional(),
    uploads: z
      .object({
        max_file_bytes: z.number(),
        remaining_bytes: z
          .number()
          .optional()
          .describe('What the quota has left; absent without a quota'),
      })
      .optional(),
    upload_profiles: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          default: z.boolean().optional(),
        })
      )
      .optional()
      .describe('Saved upload presets; pass an ID or name as `profile`'),
  }),
  async run(_args, { principal, origin, allows }) {
    const { user } = principal
    const [config, account] = await Promise.all([
      getConfig(),
      prisma.user.findUnique({
        where: { id: user.id },
        select: { storageUsed: true, defaultUploadProfileId: true },
      }),
    ])
    const usedMb = account?.storageUsed ?? user.storageUsed
    const quota = storageQuotaBytes(config, user)
    const capacity = uploadCapacity(config, user, usedMb)
    // Storage is the account's to see with a scope that lists or adds files,
    // while its role still lets it do either.
    const seesStorage = (
      [
        ['files:read', 'files.read'],
        ['files:upload', 'files.upload'],
      ] as const
    ).some(
      ([scope, permission]) =>
        principal.scopes.includes(scope) && principal.can(permission)
    )
    // A token bound to a profile uploads with that one alone, so it is the
    // only one worth naming.
    const bound = user.apiToken?.profileId ?? null
    const profiles = allows('upload_profiles')
      ? await prisma.uploadProfile.findMany({
          where: { userId: user.id, ...(bound && { id: bound }) },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : null
    return {
      structured: compact({
        account: compact({
          id: user.id,
          name: principal.name ?? undefined,
          roles: user.roles.map((role) => role.name),
        }),
        instance: { url: origin, version: getBuildInfo().version },
        connection: compact({
          scopes: [...principal.scopes],
          tools: TOOL_NAMES.filter((name) => toolAllowed(name, principal)),
          upload_profile: bound
            ? compact({
                id: bound,
                name: profiles?.find((profile) => profile.id === bound)?.name,
              })
            : undefined,
        }),
        storage: seesStorage
          ? compact({
              used_bytes: Math.round(mbToBytes(usedMb)),
              quota_bytes: quota ?? undefined,
            })
          : undefined,
        uploads: allows('upload_limits')
          ? compact({
              max_file_bytes: capacity.fileBytes,
              remaining_bytes: Number.isFinite(capacity.quotaBytes)
                ? Math.max(0, Math.round(capacity.quotaBytes))
                : undefined,
            })
          : undefined,
        upload_profiles: profiles?.map((profile) =>
          compact({
            id: profile.id,
            name: profile.name,
            default:
              profile.id === account?.defaultUploadProfileId || undefined,
          })
        ),
      }),
    }
  },
})

export const accountTools = [getAccount]
