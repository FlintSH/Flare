import { z } from 'zod'

/**
 * URL DTO Types
 */

// Create URL request schema
export const CreateUrlSchema = z.object({
  url: z.string().url(),
})

export type CreateUrlRequest = z.infer<typeof CreateUrlSchema>

// URL response
export interface UrlResponse {
  id: string
  shortCode: string
  targetUrl: string
  createdAt: Date
  clicks: number
  userId: string
}

// Create URL response
export interface CreateUrlResponse {
  id: string
  shortCode: string
  targetUrl: string
  createdAt: Date
  clicks: number
  userId: string
}

// List URLs response
export interface UrlListResponse {
  urls: UrlResponse[]
}
