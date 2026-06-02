import { NextRequest, NextResponse } from 'next/server'

const PASSWORD = process.env.DASHBOARD_PASSWORD ?? '7P7yKLqJhZYjqvrV'
const COOKIE = 'dash_auth'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  if (password !== PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, PASSWORD, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 dias
    path: '/',
  })
  return res
}
