import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const PROPERTY_ID = process.env.GA_PROPERTY_ID!
const CLIENT_EMAIL = process.env.GA_CLIENT_EMAIL!
const PRIVATE_KEY = (process.env.GA_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')

// GA4 Data API endpoint
const GA4_URL = `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))
  const unsigned = `${header}.${payload}`

  // Import private key and sign
  const keyData = PRIVATE_KEY
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(unsigned)
  )
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const jwt = `${unsigned}.${b64sig}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    throw new Error(`GA4 token error: ${err}`)
  }
  const { access_token } = await tokenRes.json()
  return access_token
}

async function runReport(token: string, startDate: string, endDate: string) {
  const body = {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'addToCarts' },
      { name: 'checkouts' },
      { name: 'ecommercePurchases' },
      { name: 'purchaseRevenue' },
    ],
  }
  const res = await fetch(GA4_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GA4 report error: ${err}`)
  }
  return res.json()
}

export async function GET(req: Request) {
  if (!PROPERTY_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return NextResponse.json({ error: 'GA4 env vars not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('startDate') ?? '30daysAgo'
  const endDate = searchParams.get('endDate') ?? 'today'

  try {
    const token = await getAccessToken()
    const report = await runReport(token, startDate, endDate)

    const row = report.rows?.[0]?.metricValues ?? []
    const get = (i: number) => parseFloat(row[i]?.value ?? '0')

    const sessions       = get(0)
    const users          = get(1)
    const addToCarts     = get(2)
    const checkouts      = get(3)
    const purchases      = get(4)
    const revenue        = get(5)

    return NextResponse.json({
      startDate,
      endDate,
      sessions,
      users,
      addToCarts,
      checkouts,
      purchases,
      revenue,
      funnel: [
        { step: 'Sessões',        value: sessions,    pct: 100 },
        { step: 'Usuários ativos',value: users,       pct: sessions > 0 ? Math.round(users / sessions * 1000) / 10 : 0 },
        { step: 'Add ao carrinho',value: addToCarts,  pct: sessions > 0 ? Math.round(addToCarts / sessions * 1000) / 10 : 0 },
        { step: 'Checkout',       value: checkouts,   pct: sessions > 0 ? Math.round(checkouts / sessions * 1000) / 10 : 0 },
        { step: 'Compras',        value: purchases,   pct: sessions > 0 ? Math.round(purchases / sessions * 1000) / 10 : 0 },
      ],
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
