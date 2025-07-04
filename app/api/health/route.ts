import { apiResponse } from '@/lib/api/response'

export async function GET() {
  return apiResponse({ status: 'ok' })
}
