import { NextResponse } from 'next/server'

export async function GET() {
  const clientId = process.env.GA_OAUTH_CLIENT_ID!
  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dacar-dash.vercel.app'}/api/ga-oauth-callback`

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/analytics.readonly')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')

  return NextResponse.redirect(url.toString())
}
