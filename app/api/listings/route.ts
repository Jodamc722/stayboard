import { NextResponse } from 'next/server'
import { listListings } from '@/lib/guesty'

export async function GET() {
  try {
    const data = await listListings()
    return NextResponse.json({ results: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
