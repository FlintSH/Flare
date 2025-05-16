import { apiResponse } from '@/lib/api/response'

// this endpoint can be used as a health check if
// you want to set that up with your deployment
export async function GET() {
  return apiResponse({ status: 'ok' })
}
