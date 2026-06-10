import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!
const headers = {
  'X-VTEX-API-AppKey': APP_KEY,
  'X-VTEX-API-AppToken': APP_TOKEN,
  'Content-Type': 'application/json',
}

const PAID_STATUSES = new Set([
  'payment-approved', 'invoiced', 'handling',
  'ready-for-handling', 'waiting-for-fulfillment',
  'shipped', 'delivered', 'order-completed',
])

const KG_TO_LITERS = 1.0

function parseVolumeFromName(name: string): { liters: number; detail: string } {
  let liters = 0
  const parts: string[] = []

  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*ml\b/gi)]) {
    const v = parseFloat(m[1].replace(',', '.')) / 1000
    liters += v
    parts.push(`${m[0]} → ${v.toFixed(3)}L (ml)`)
  }

  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?|l)\b/gi)]) {
    const idx = m.index ?? 0
    const charBefore = idx > 0 ? name[idx - 1] : ''
    if (charBefore.toLowerCase() === 'm') continue
    const v = parseFloat(m[1].replace(',', '.'))
    liters += v
    parts.push(`${m[0]} → ${v}L`)
  }

  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*kgs?\b/gi)]) {
    const v = parseFloat(m[1].replace(',', '.')) * KG_TO_LITERS
    liters += v
    parts.push(`${m[0]} → ${v}L (kg×${KG_TO_LITERS})`)
  }

  return { liters, detail: parts.length > 0 ? parts.join(', ') : 'NÃO PARSEADO' }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cnpj = searchParams.get('cnpj')?.replace(/\D/g, '') ?? '57859944000136'

  // 1. Busca email pelo CNPJ
  const r1 = await fetch(
    `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/search?_fields=email,corporateDocument,tradeName,corporateName&corporateDocument=${cnpj}`,
    { headers: { ...headers, 'REST-Range': 'resources=0-5' } }
  )
  const profile = r1.ok ? await r1.json() : []
  if (!profile?.[0]?.email) return NextResponse.json({ error: 'CNPJ não encontrado', cnpj })

  const email = profile[0].email
  const realEmail = email.endsWith('.ct.vtex.com.br')
    ? email.replace(/\.ct\.vtex\.com\.br$/, '').replace(/-[^-]+$/, '')
    : email

  // 2. Busca pedidos
  const r2 = await fetch(
    `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?q=${encodeURIComponent(realEmail)}&per_page=20`,
    { headers }
  )
  const ordersData = r2.ok ? await r2.json() : {}
  const orders = ordersData.list ?? []

  // 3. Detalha cada pedido
  const details = await Promise.all(orders.map(async (o: { orderId: string; status: string; totalValue: number; creationDate: string }) => {
    const r = await fetch(`https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders/${o.orderId}`, { headers })
    const d = r.ok ? await r.json() : null
    const isPaid = PAID_STATUSES.has(o.status)

    const itemBreakdown = (d?.items ?? []).map((item: { name: string; quantity: number; sellingPrice: number }) => {
      const { liters, detail } = parseVolumeFromName(item.name ?? '')
      return {
        name: item.name,
        quantity: item.quantity,
        parsedLitersPerUnit: liters,
        parsedLitersTotal: Math.round(liters * item.quantity * 100) / 100,
        parseDetail: detail,
      }
    })

    const totalVolume = itemBreakdown.reduce((s: number, i: { parsedLitersTotal: number }) => s + i.parsedLitersTotal, 0)

    return {
      orderId: o.orderId,
      status: o.status,
      isPaid,
      value: o.totalValue / 100,
      date: o.creationDate,
      countedInVolume: isPaid,
      totalVolumeL: Math.round(totalVolume * 100) / 100,
      items: itemBreakdown,
    }
  }))

  const grandTotal = details
    .filter(d => d.isPaid)
    .reduce((s, d) => s + d.totalVolumeL, 0)

  return NextResponse.json({
    cnpj,
    email: realEmail,
    tradeName: profile[0].tradeName ?? profile[0].corporateName,
    totalPaidVolumeL: Math.round(grandTotal * 100) / 100,
    orders: details,
  })
}
