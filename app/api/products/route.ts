import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!
const h = { 'X-VTEX-API-AppKey': APP_KEY, 'X-VTEX-API-AppToken': APP_TOKEN, 'Content-Type': 'application/json' }

const PAID = new Set(['payment-approved','invoiced','handling','ready-for-handling','waiting-for-fulfillment','shipped','delivered','order-completed'])

const PACK_RULES = [
  { l: 18, p: 1 }, { l: 16, p: 1 }, { l: 15, p: 1 }, { l: 24, p: 1 }, { l: 20, p: 1 },
  { l: 3.6, p: 4 }, { l: 5.7, p: 4 }, { l: 5.8, p: 4 },
  { l: 5, p: 6 }, { l: 1.4, p: 6 }, { l: 0.9, p: 6 },
  { l: 0.225, p: 12 }, { l: 0.1125, p: 12 },
]
function packSize(l: number) { return PACK_RULES.find(r => Math.abs(r.l - l) < 0.01)?.p ?? 1 }

// Densidade por categoria (Kg ÷ divisor = litros). Dados do laboratório Dacar.
function densityDivisor(name: string): number {
  const n = name.toLowerCase()
  if (/textura/.test(n)) return 1.85
  if (/borracha/.test(n)) return 1.25
  if (/massa|efeito\s*decorativo/.test(n)) return 1.70
  return 1.0
}

// Retorna { liters, packBasis }: litros já convertidos e o valor rotulado p/ casar pacote
function parseVol(name: string): { liters: number; packBasis: number } {
  let liters = 0, packBasis = 0
  const div = densityDivisor(name)
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*ml\b/gi)]) {
    const v = parseFloat(m[1].replace(',', '.')) / 1000; liters += v; packBasis += v
  }
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?|l)\b/gi)]) {
    const idx = m.index ?? 0; if (idx > 0 && name[idx - 1].toLowerCase() === 'm') continue
    const v = parseFloat(m[1].replace(',', '.')); liters += v; packBasis += v
  }
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*kgs?\b/gi)]) {
    const kg = parseFloat(m[1].replace(',', '.')); liters += kg / div; packBasis += kg
  }
  return { liters, packBasis }
}
function itemVol(name: string): number { const { liters, packBasis } = parseVol(name); return liters * packSize(packBasis) }

interface OListItem { orderId: string; totalValue: number; creationDate: string; status: string }

async function fetchAllOrders(dateFrom: string, dateTo: string): Promise<OListItem[]> {
  const url = (p: number) =>
    `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?f_creationDate=creationDate:[${dateFrom}T00:00:00.000Z+TO+${dateTo}T23:59:59.999Z]&page=${p}&per_page=100`
  const first = await fetch(url(1), { headers: h }); if (!first.ok) return []
  const d = await first.json()
  const pages = Math.min(Math.ceil((d.paging?.total ?? 0) / 100), 20)
  if (pages <= 1) return d.list ?? []
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) =>
    fetch(url(i + 2), { headers: h }).then(r => r.ok ? r.json().then((j: { list?: OListItem[] }) => j.list ?? []) : [])
  ))
  return [...(d.list ?? []), ...rest.flat()]
}

interface SKURow {
  name: string
  orders: number
  unitsSold: number
  revenue: number
  volumeL: number
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('from') ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const dateTo   = searchParams.get('to')   ?? new Date().toISOString().slice(0, 10)

  const allOrders = await fetchAllOrders(dateFrom, dateTo)
  const paidIds = allOrders.filter(o => PAID.has(o.status)).map(o => o.orderId)

  // Fetch order details in batches of 15
  const skuMap = new Map<string, SKURow>()

  for (let i = 0; i < paidIds.length; i += 15) {
    const batch = await Promise.all(
      paidIds.slice(i, i + 15).map(id =>
        fetch(`https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders/${id}`, { headers: h })
          .then(r => r.ok ? r.json() : null)
      )
    )
    for (const detail of batch) {
      if (!detail?.items) continue
      const orderIds = new Set<string>() // track which skus appear in this order (for order count)
      for (const item of detail.items) {
        const name: string = item.name ?? 'Desconhecido'
        const qty: number = item.quantity ?? 1
        const price: number = (item.sellingPrice ?? 0) / 100 // centavos → reais
        const volPerUnit = itemVol(name)

        if (!skuMap.has(name)) skuMap.set(name, { name, orders: 0, unitsSold: 0, revenue: 0, volumeL: 0 })
        const row = skuMap.get(name)!
        if (!orderIds.has(name)) { row.orders++; orderIds.add(name) }
        row.unitsSold += qty
        row.revenue   += price * qty
        row.volumeL   += volPerUnit * qty
      }
    }
  }

  const skus = [...skuMap.values()]
    .map(s => ({ ...s, revenue: Math.round(s.revenue * 100) / 100, volumeL: Math.round(s.volumeL * 10) / 10 }))
    .sort((a, b) => b.revenue - a.revenue)

  const totalRevenue = skus.reduce((s, r) => s + r.revenue, 0)
  const totalVolumeL = skus.reduce((s, r) => s + r.volumeL, 0)
  const totalOrders  = paidIds.length

  return NextResponse.json({ skus, totalRevenue, totalVolumeL, totalOrders, dateFrom, dateTo })
}
