import { faviconResponse } from '@/lib/customization/favicon/server'
import { loggers } from '@/lib/logger'

export async function GET(request: Request) {
  try {
    return await faviconResponse(request)
  } catch (error) {
    loggers.files.error('Favicon serve error:', error as Error)
    return new Response(null, { status: 500 })
  }
}
