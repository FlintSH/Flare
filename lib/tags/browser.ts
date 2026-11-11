import { apiRequest } from '@/lib/client/request'

import type { TagsApi } from './client'
import type { TagView } from './schema'

/** The tag procedures' requests to Flare's API. Client only. */
export const tagsApi: TagsApi = {
  tags: () => apiRequest<TagView[]>('/api/tags'),
  seal: (tags) =>
    apiRequest('/api/tags/sealed', { method: 'PUT', body: { tags } }),
  plainText: (after) =>
    apiRequest(
      `/api/files/text${after ? `?after=${encodeURIComponent(after)}` : ''}`
    ),
  encrypted: (since) => apiRequest(`/api/files/sync?since=${since}&limit=500`),
  apply: (tagId, fileIds) =>
    apiRequest(`/api/tags/${encodeURIComponent(tagId)}/apply`, {
      body: { fileIds },
    }),
}
