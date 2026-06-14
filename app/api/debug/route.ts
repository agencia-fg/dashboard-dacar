import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!

const headers = {
  'X-VTEX-API-AppKey': APP_KEY,
  'X-VTEX-API-AppToken': APP_TOKEN,
  'Content-Type': 'application/json',
}

// Uso: /api/debug?cnpj=65733397000176  ou  /api/debug?email=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cnpj = searchParams.get('cnpj')
  const email = searchParams.get('email')
  const results: Record<string, unknown> = {}

  // 1. Registro CL completo (TODOS os campos) — para achar tipo VAREJO/CONSTRUTORA
  try {
    let url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/search?_fields=_all`
    if (cnpj) url += `&corporateDocument=${cnpj}`
    else if (email) url += `&email=${encodeURIComponent(email)}`
    const r = await fetch(url, { headers: { ...headers, 'REST-Range': 'resources=0-1' } })
    results.CL_full = { status: r.status, body: r.ok ? await r.json() : await r.text() }
  } catch (e) { results.CL_full = { error: String(e) } }

  // 2. Rastreia a estrutura B2B do cliente: b2b_user → org → cost_center
  if (email) {
    try {
      const uUrl = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/b2b_users/search?_fields=_all&email=${encodeURIComponent(email)}`
      const ur = await fetch(uUrl, { headers: { ...headers, 'REST-Range': 'resources=0-2' } })
      const users = ur.ok ? await ur.json() : []
      results.b2b_user = users
      const orgId = users?.[0]?.orgId
      const costId = users?.[0]?.costId
      if (orgId) {
        const oUrl = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/organizations/search?_fields=_all&id=${orgId}`
        const or = await fetch(oUrl, { headers: { ...headers, 'REST-Range': 'resources=0-0' } })
        results.org_do_cliente = or.ok ? await or.json() : await or.text()
      }
      if (costId) {
        const cUrl = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/cost_centers/search?_fields=_all&id=${costId}`
        const cr = await fetch(cUrl, { headers: { ...headers, 'REST-Range': 'resources=0-0' } })
        results.cost_center_do_cliente = cr.ok ? await cr.json() : await cr.text()
      }
    } catch (e) { results.b2b_chain = { error: String(e) } }
  }

  // 3. Amostra de cost_centers e organizations (achar campo de tipo)
  try {
    const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/cost_centers/search?_fields=_all`
    const r = await fetch(url, { headers: { ...headers, 'REST-Range': 'resources=0-2' } })
    results.cost_centers_sample = { status: r.status, body: r.ok ? await r.json() : await r.text() }
  } catch (e) { results.cost_centers_sample = { error: String(e) } }

  // 4. Pedidos do CNPJ/email — status + valor + itens + volume parseado
  if (cnpj || email) {
    try {
      const q = cnpj ?? email
      const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?q=${encodeURIComponent(q!)}&per_page=20&page=1`
      const r = await fetch(url, { headers })
      const listData = r.ok ? await r.json() : null
      const list = listData?.list ?? []
      const orders = await Promise.all(list.slice(0, 10).map(async (o: { orderId: string }) => {
        const dr = await fetch(`https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders/${o.orderId}`, { headers })
        if (!dr.ok) return { orderId: o.orderId, error: dr.status }
        const d = await dr.json()
        return {
          orderId: d.orderId,
          status: d.status,
          value: (d.value ?? 0) / 100,
          creationDate: d.creationDate,
          items: (d.items ?? []).map((it: { name: string; quantity: number }) => ({ name: it.name, qty: it.quantity })),
        }
      }))
      results.orders = { count: list.length, orders }
    } catch (e) { results.orders = { error: String(e) } }
  }

  return NextResponse.json(results, { status: 200 })
}
