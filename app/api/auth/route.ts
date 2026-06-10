import { NextRequest, NextResponse } from 'next/server'

const COOKIE = 'dash_auth'

interface User { email: string; password: string; name: string }

function getUsers(): User[] {
  try {
    return JSON.parse(process.env.DASHBOARD_USERS ?? '[]')
  } catch {
    return []
  }
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  const user = getUsers().find(
    u => u.email.toLowerCase() === email?.toLowerCase() && u.password === password
  )

  if (!user) {
    return NextResponse.json({ error: 'E-mail ou senha incorretos' }, { status: 401 })
  }

  const token = Buffer.from(`${user.email}:${user.password}`).toString('base64')
  const res = NextResponse.json({ ok: true, name: user.name })
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(COOKIE)
  return res
}
