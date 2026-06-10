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

function isValidToken(token: string): boolean {
  try {
    const decoded = atob(token)
    const colon = decoded.indexOf(':')
    if (colon === -1) return false
    const email = decoded.slice(0, colon)
    const password = decoded.slice(colon + 1)
    return getUsers().some(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    )
  } catch {
    return false
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname === '/login') {
    return NextResponse.next()
  }

  const token = req.cookies.get(COOKIE)?.value
  if (token && isValidToken(token)) return NextResponse.next()

  const loginUrl = req.nextUrl.clone()
  loginUrl.pathname = '/login'
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
