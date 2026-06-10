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
  const today = new Date().toISOString().split('T')[0]
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

  // Test AC: Abandoned Checkouts
  try {
    const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/AC/search?_fields=email,createdIn,lastInteractionIn,status,cartValue&_sort=createdIn%20DESC`
    const r = await fetch(url, { headers: { ...headers, 'REST-Range': 'resources=0-3' } })
    results.AC_entity = { status: r.status, body: r.ok ? await r.json() : await r.text() }
  } catch (e) { results.AC_entity = { error: String(e) } }

  // Test CC: Carrinhos (outra entidade possível)
  try {
    const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CC/search?_fields=email,createdIn,status&_sort=createdIn%20DESC`
    const r = await fetch(url, { headers: { ...headers, 'REST-Range': 'resources=0-2' } })
    results.CC_entity = { status: r.status, body: r.ok ? await r.json() : await r.text() }
  } catch (e) { results.CC_entity = { error: String(e) } }

  // Test lista entidades disponíveis
  try {
    const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities`
    const r = await fetch(url, { headers })
    results.masterdata_entities = { status: r.status, body: r.ok ? await r.json() : await r.text() }
  } catch (e) { results.masterdata_entities = { error: String(e) } }

  return NextResponse.json(results, { status: 200 })
}
