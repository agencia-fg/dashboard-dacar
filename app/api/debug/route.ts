import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!

const headers = {
  'X-VTEX-API-AppKey': APP_KEY,
  'X-VTEX-API-AppToken': APP_TOKEN,
  'Content-Type': 'application/json',
}

export async function GET() {
  const results: Record<string, unknown> = {}
  const testEmail = 'samir@conceitoemoradia.com.br'

  // Test 1: email como query param direto
  try {
    const url1 = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/search?_fields=id,email,createdIn&email=${encodeURIComponent(testEmail)}`
    const r1 = await fetch(url1, { headers: { ...headers, 'REST-Range': 'resources=0-2' } })
    results.t1_email_queryparam = { status: r1.status, url: url1, body: await r1.json() }
  } catch (e) { results.t1_email_queryparam = { error: String(e) } }

  // Test 2: _where com = encodado
  try {
    const where = encodeURIComponent(`email=${testEmail}`)
    const url2 = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/search?_fields=id,email,createdIn&_where=${where}`
    const r2 = await fetch(url2, { headers: { ...headers, 'REST-Range': 'resources=0-2' } })
    results.t2_where_encoded = { status: r2.status, url: url2, body: await r2.json() }
  } catch (e) { results.t2_where_encoded = { error: String(e) } }

  // Test 3: full text search com q=email
  try {
    const url3 = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/search?_fields=id,email,createdIn&_keyword=${encodeURIComponent(testEmail)}`
    const r3 = await fetch(url3, { headers: { ...headers, 'REST-Range': 'resources=0-2' } })
    results.t3_keyword = { status: r3.status, body: await r3.json() }
  } catch (e) { results.t3_keyword = { error: String(e) } }

  // Test 4: ver campos disponíveis no schema CL
  try {
    const url4 = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/schema`
    const r4 = await fetch(url4, { headers })
    results.t4_schema = { status: r4.status, body: await r4.json() }
  } catch (e) { results.t4_schema = { error: String(e) } }

  return NextResponse.json(results, { status: 200 })
}
