import { NextResponse } from 'next/server'

export async function GET() {
  const raw = process.env.DASHBOARD_USERS ?? '(não definida)'
  let parsed = null
  let error = null
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    error = String(e)
  }
  return NextResponse.json({
    raw: raw.slice(0, 600),
    parsed: parsed ? parsed.map((u: { email: string; name: string }) => ({ email: u.email, name: u.name })) : null,
    error,
  })
}
