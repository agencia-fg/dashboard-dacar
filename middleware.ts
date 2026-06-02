import { NextRequest, NextResponse } from 'next/server'

const PASSWORD = process.env.DASHBOARD_PASSWORD ?? '7P7yKLqJhZYjqvrV'
const COOKIE = 'dash_auth'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow API and static files
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname === '/login') {
    return NextResponse.next()
  }

  const auth = req.cookies.get(COOKIE)?.value
  if (auth === PASSWORD) return NextResponse.next()

  const loginUrl = req.nextUrl.clone()
  loginUrl.pathname = '/login'
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
