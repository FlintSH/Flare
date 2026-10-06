import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { TagError } from '@/lib/tags/service'

type FileTagMembership = {
  id: string
  tags: { id: string; name: string }[]
}

/** Read a bounded selection at one database snapshot, including untagged files. */
export async function fileTagMembership(userId: string, fileIds: string[]) {
  const ids = [...new Set(fileIds)]
  const files = await prisma.$queryRaw<FileTagMembership[]>(Prisma.sql`
    SELECT f.id,
      COALESCE(
        jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name)
          ORDER BY tag."normalizedName", tag.id)
          FILTER (WHERE tag.id IS NOT NULL),
        '[]'::jsonb
      ) AS tags
    FROM "File" f
    LEFT JOIN "VaultFileTag" ft ON ft."fileId" = f.id AND ft.excluded = false
    LEFT JOIN "VaultTag" tag ON tag.id = ft."tagId" AND tag."userId" = ${userId}
    WHERE f."userId" = ${userId} AND f.id IN (${Prisma.join(ids)})
    GROUP BY f.id
  `)
  if (files.length !== ids.length)
    throw new TagError('One or more files are no longer available.', 404)
  const byId = new Map(files.map((file) => [file.id, file]))
  return ids.map((id) => byId.get(id)!)
}
