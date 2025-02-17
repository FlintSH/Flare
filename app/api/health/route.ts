import { NextResponse } from 'next/server'

// this endpoint can be used as a health check if
// you want to set that up with your deployment
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
