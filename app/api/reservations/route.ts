import { NextResponse } from 'next/server'
import { listReservations } from '@/lib/guesty'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') || 30)
  try {
    const data = await listReservations(limit)
    return NextResponse.json({ results: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
