import { z } from 'zod'

export const CreateUrlSchema = z.object({
  url: z.string().url(),
})

export type CreateUrlRequest = z.infer<typeof CreateUrlSchema>

export interface UrlResponse {
  id: string
  shortCode: string
  targetUrl: string
  createdAt: Date
  clicks: number
  userId: string
}

export interface CreateUrlResponse {
  id: string
  shortCode: string
  targetUrl: string
  createdAt: Date
  clicks: number
  userId: string
}

export interface UrlListResponse {
  urls: UrlResponse[]
}
