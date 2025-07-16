import { NextResponse } from 'next/server'

import { checkSetupCompletion } from '@/lib/database/setup'

export async function GET() {
  try {
    const completed = await checkSetupCompletion()
    return NextResponse.json({ completed })
  } catch (error) {
    console.error('Setup check error:', error)
    return NextResponse.json({ completed: false })
  }
}
