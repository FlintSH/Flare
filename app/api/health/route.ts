import { apiResponse } from '@/lib/http/response'

export async function GET() {
  return apiResponse({ status: 'ok' })
}
