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

  // Test 1: entidade 'cart' (carrinhos abandonados)
  try {
    const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/cart/search?_fields=email,createdIn,status&_where=createdIn%20between%20${monthAgo}T00%3A00%3A00.000Z%20AND%20${today}T23%3A59%3A59.999Z&_sort=createdIn%20DESC`
    const r = await fetch(url, { headers: { ...headers, 'REST-Range': 'resources=0-4' } })
    results.cart_entity = { status: r.status, body: r.ok ? await r.json() : await r.text() }
  } catch (e) { results.cart_entity = { error: String(e) } }

  // Test 2: entidade 'Cart' com C maiúsculo
  try {
    const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/Cart/search?_fields=email,createdIn&_sort=createdIn%20DESC`
    const r = await fetch(url, { headers: { ...headers, 'REST-Range': 'resources=0-2' } })
    results.Cart_entity = { status: r.status, body: r.ok ? await r.json() : await r.text() }
  } catch (e) { results.Cart_entity = { error: String(e) } }

  // Test 3: checkout orderForm abandonado (API pública)
  try {
    const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/checkout/pvt/configuration/orderForm`
    const r = await fetch(url, { headers })
    results.checkout_config = { status: r.status }
  } catch (e) { results.checkout_config = { error: String(e) } }

  // Test 4: lista schemas MasterData disponíveis
  try {
    const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities`
    const r = await fetch(url, { headers })
    results.masterdata_entities = { status: r.status, body: r.ok ? await r.json() : await r.text() }
  } catch (e) { results.masterdata_entities = { error: String(e) } }

  return NextResponse.json(results, { status: 200 })
}
