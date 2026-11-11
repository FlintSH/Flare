import { prisma } from '@/lib/database/prisma'
import {
  fileUrls,
  sharedFolderFileUrl,
  sharedFolderUrl,
} from '@/lib/files/urls'
import { sameStoredBytes, wireBytes } from '@/lib/library/sealed-fields'

export const SHARED_FOLDER_PAGE_SIZE = 48
/** Folders nest far less deeply than this; it only bounds a walk up the tree. */
const MAX_DEPTH = 64

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/

/**
 * What "Back to …" calls a shared folder whose name only the link's key
 * opens.
 */
export const SHARED_FOLDER_LABEL = 'the shared folder'

/** A folder as a shared folder page gets it. */
export interface SharedFolderNode {
  id: string
  /** Null for a folder that has keys: the visitor's browser opens `keys`. */
  name: string | null
  keys: {
    folderPublicKey: string
    sealedFolderMetadata: string
    /**
     * The private key of this folder, encrypted to its parent. Null for the
     * folder that the link shares, and while the owner's browser has not made
     * one for the parent's current key.
     */
    parentFolderStanza: string | null
  } | null
}

export type SharedFolderFile =
  | {
      id: string
      encrypted: false
      name: string
      href: string
      rawUrl: string | null
      mimeType: string | null
      size: number | null
      hasPassword: boolean
    }
  | {
      id: string
      encrypted: true
      /** The address of the file's page. The browser adds the key after `#`. */
      href: string
      size: number
      hasPassword: boolean
      header: string
      sealedMetadata: string
      /**
       * A `folder_file_stanza`, or a `folder_link_secret_stanza` when the
       * file has a password (docs/e2ee-spec.md, section 8.4.3).
       */
      folderStanza: string
    }

const nodeSelect = {
  id: true,
  name: true,
  parentId: true,
  folderPublicKey: true,
  sealedFolderMetadata: true,
  parentFolderStanza: true,
  parentStanzaPublicKey: true,
  rekeyPending: true,
} as const

type NodeRow = {
  id: string
  name: string
  parentId: string | null
  folderPublicKey: Uint8Array | null
  sealedFolderMetadata: Uint8Array | null
  parentFolderStanza: Uint8Array | null
  parentStanzaPublicKey: Uint8Array | null
  rekeyPending: boolean
}

function node(row: NodeRow, parent: NodeRow | null): SharedFolderNode {
  if (!row.folderPublicKey || !row.sealedFolderMetadata)
    return { id: row.id, name: row.name, keys: null }
  // A folder that waits for new keys gives nothing: its old key is the one
  // that an old link carries (section 9.4.5).
  const current =
    parent &&
    !row.rekeyPending &&
    !parent.rekeyPending &&
    sameStoredBytes(row.parentStanzaPublicKey, parent.folderPublicKey)
  return {
    id: row.id,
    name: null,
    keys: {
      folderPublicKey: wireBytes(row.folderPublicKey)!,
      sealedFolderMetadata: wireBytes(row.sealedFolderMetadata)!,
      parentFolderStanza: current ? wireBytes(row.parentFolderStanza) : null,
    },
  }
}

/**
 * The folders from the one a link shares down to `folderId`, or null when
 * `folderId` is not that folder or a folder below it.
 */
async function sharedTrail(
  token: string,
  folderId: string | null
): Promise<NodeRow[] | null> {
  if (!TOKEN.test(token)) return null
  const root = await prisma.vaultFolder.findUnique({
    where: { shareToken: token },
    select: { ...nodeSelect, userId: true },
  })
  if (!root) return null
  if (!folderId || folderId === root.id) return [root]
  const trail: NodeRow[] = []
  let current: string | null = folderId
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    if (current === root.id) return [root, ...trail]
    const row: NodeRow | null = await prisma.vaultFolder.findFirst({
      where: { id: current, userId: root.userId },
      select: nodeSelect,
    })
    if (!row) return null
    trail.unshift(row)
    current = row.parentId
  }
  return null
}

/** Whether `folderId` is the folder that `token` shares or a folder below it. */
export async function isWithinSharedFolder(
  token: string,
  folderId: string | null
): Promise<boolean> {
  return Boolean(folderId && (await sharedTrail(token, folderId)))
}

/**
 * One folder of a shared link: the folder that the link shares, or with
 * `folderId` a folder below it (section 9.4.3). Public reads omit owner
 * details, tags and private files.
 *
 * Plain files appear as they always did. An encrypted file appears with its
 * records when it has a folder stanza for the current key of its folder:
 * the visitor's browser opens the stanza with the key after `#` and never
 * sends that key. Plain and encrypted files share one list, newest first.
 */
export async function getSharedFolder(
  token: string,
  page = 1,
  folderId: string | null = null
) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return null
  const trail = await sharedTrail(token, folderId)
  if (!trail) return null
  const open = trail[trail.length - 1]
  const visible = {
    folderId: open.id,
    visibility: 'PUBLIC' as const,
    OR: [
      { encrypted: false },
      ...(open.folderPublicKey && !open.rekeyPending
        ? [
            {
              encrypted: true,
              folderStanza: { not: null },
              folderStanzaPublicKey: Uint8Array.from(open.folderPublicKey),
            },
          ]
        : []),
    ],
  }
  const [total, files, children] = await Promise.all([
    prisma.file.count({ where: visible }),
    prisma.file.findMany({
      where: visible,
      orderBy: [{ uploadedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * SHARED_FOLDER_PAGE_SIZE,
      take: SHARED_FOLDER_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        urlPath: true,
        mimeType: true,
        size: true,
        password: true,
        encrypted: true,
        header: true,
        sealedMetadata: true,
        passwordStanza: true,
        folderStanza: true,
      },
    }),
    prisma.vaultFolder.findMany({
      where: { parentId: open.id },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      select: nodeSelect,
    }),
  ])
  const nodes = trail.map((row, index) => node(row, trail[index - 1] ?? null))
  return {
    token,
    root: nodes[0],
    trail: nodes,
    folders: children.map((child) => node(child, open)),
    page,
    total,
    pageCount: Math.ceil(total / SHARED_FOLDER_PAGE_SIZE),
    files: files.map((file): SharedFolderFile => {
      const urls = fileUrls(file)
      if (file.encrypted && file.header && file.sealedMetadata)
        return {
          id: file.id,
          encrypted: true,
          href: urls.page,
          size: file.size,
          hasPassword: Boolean(file.passwordStanza),
          header: wireBytes(file.header)!,
          sealedMetadata: wireBytes(file.sealedMetadata)!,
          folderStanza: wireBytes(file.folderStanza)!,
        }
      return {
        id: file.id,
        encrypted: false,
        name: file.password ? 'Password-protected file' : file.name,
        // Even the link target must hide a protected file's filename. This
        // route checks membership and the password before revealing its
        // canonical URL.
        href: file.password ? sharedFolderFileUrl(token, file.id) : urls.page,
        rawUrl: file.password ? null : urls.raw,
        mimeType: file.password ? null : file.mimeType,
        size: file.password ? null : file.size,
        hasPassword: Boolean(file.password),
      }
    }),
  }
}

export type SharedFolderListing = NonNullable<
  Awaited<ReturnType<typeof getSharedFolder>>
>

/**
 * A visitor who opened this file from a shared folder gets a link back to it.
 * Shared folder pages send their address as the referrer to this origin only,
 * so the folder's share token never has to appear in the file's own URL. The
 * link appears only while the file is still a public member of that folder
 * or of a folder below it.
 *
 * The referrer never has the part after `#`. For a folder that has keys the
 * link is marked `history`: the page goes back in the browser's history,
 * where the address still has the key.
 */
export async function sharedFolderBackLink(
  file: { folderId: string | null; visibility: string },
  referer: string | null
): Promise<{ href: string; label: string; history?: boolean } | null> {
  if (!referer || !file.folderId || file.visibility !== 'PUBLIC') return null
  let from: URL
  try {
    from = new URL(referer)
  } catch {
    return null
  }
  const match =
    /^\/s\/folders\/([A-Za-z0-9_-]{20,100})(\/files\/[^/]+)?\/?$/.exec(
      from.pathname
    )
  if (!match) return null
  const [, token, viaFileRoute] = match
  const trail = await sharedTrail(token, file.folderId)
  if (!trail) return null
  const [root] = trail
  const open = trail[trail.length - 1]
  const page = viaFileRoute ? 1 : Number(from.searchParams.get('page') ?? 1)
  return {
    href: sharedFolderUrl(token, {
      page: Number.isSafeInteger(page) && page <= 100000 ? page : 1,
      folder: open.id === root.id ? null : open.id,
    }),
    label: open.folderPublicKey ? SHARED_FOLDER_LABEL : open.name,
    ...(root.folderPublicKey && { history: true }),
  }
}
