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

  // Test 1: Orders API - sem filtro nenhum (últimos pedidos)
  try {
    const url1 = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?per_page=5&page=1`
    const r1 = await fetch(url1, { headers })
    results.orders_no_filter = {
      status: r1.status,
      body: await r1.json(),
    }
  } catch (e) {
    results.orders_no_filter = { error: String(e) }
  }

  // Test 2: Orders API - com filtro de data
  try {
    const url2 = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?f_creationDate=creationDate:[2025-06-01T00:00:00.000Z+TO+2026-06-02T23:59:59.999Z]&per_page=5&page=1`
    const r2 = await fetch(url2, { headers })
    results.orders_with_date = {
      status: r2.status,
      body: await r2.json(),
    }
  } catch (e) {
    results.orders_with_date = { error: String(e) }
  }

  // Test 3: MasterData - confirma que chave funciona
  try {
    const url3 = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/search?_fields=id,email&_sort=createdIn DESC`
    const r3 = await fetch(url3, {
      headers: { ...headers, 'REST-Range': 'resources=0-2' },
    })
    results.masterdata_check = {
      status: r3.status,
      body: await r3.json(),
    }
  } catch (e) {
    results.masterdata_check = { error: String(e) }
  }

  return NextResponse.json(results, { status: 200 })
}
