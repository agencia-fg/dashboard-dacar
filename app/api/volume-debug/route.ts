import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!
const headers = { 'X-VTEX-API-AppKey': APP_KEY, 'X-VTEX-API-AppToken': APP_TOKEN, 'Content-Type': 'application/json' }

const PAID_STATUSES = new Set(['payment-approved','invoiced','handling','ready-for-handling','waiting-for-fulfillment','shipped','delivered','order-completed'])
const KG_TO_LITERS = 1.0
const PACK_RULES: Array<{ liters: number; packSize: number }> = [
  { liters: 18, packSize: 1 }, { liters: 16, packSize: 1 }, { liters: 15, packSize: 1 },
  { liters: 24, packSize: 1 }, { liters: 20, packSize: 1 },
  { liters: 3.6, packSize: 4 }, { liters: 5.7, packSize: 4 }, { liters: 5.8, packSize: 4 },
  { liters: 5, packSize: 6 }, { liters: 1.4, packSize: 6 }, { liters: 0.9, packSize: 6 },
  { liters: 0.225, packSize: 12 }, { liters: 0.1125, packSize: 12 },
]

function getPackSize(l: number) {
  return PACK_RULES.find(r => Math.abs(r.liters - l) < 0.01)?.packSize ?? 1
}

function parseRawLiters(name: string): number {
  let v = 0
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*ml\b/gi)])
    v += parseFloat(m[1].replace(',', '.')) / 1000
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?|l)\b/gi)]) {
    const idx = m.index ?? 0
    if (idx > 0 && name[idx - 1].toLowerCase() === 'm') continue
    v += parseFloat(m[1].replace(',', '.'))
  }
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*kgs?\b/gi)])
    v += parseFloat(m[1].replace(',', '.')) * KG_TO_LITERS
  return v
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('from') ?? new Date(Date.now() - 9 * 86400000).toISOString().split('T')[0]
  const dateTo   = searchParams.get('to')   ?? new Date().toISOString().split('T')[0]

  // Busca até 200 pedidos pagos do período
  const res1 = await fetch(`https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?f_creationDate=creationDate:[${dateFrom}T00:00:00.000Z+TO+${dateTo}T23:59:59.999Z]&page=1&per_page=100`, { headers })
  const d1 = await res1.json()
  const total = d1.paging?.total ?? 0
  let orders = (d1.list ?? []).filter((o: { status: string }) => PAID_STATUSES.has(o.status))
  if (total > 100) {
    const res2 = await fetch(`https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?f_creationDate=creationDate:[${dateFrom}T00:00:00.000Z+TO+${dateTo}T23:59:59.999Z]&page=2&per_page=100`, { headers })
    const d2 = await res2.json()
    orders = [...orders, ...(d2.list ?? []).filter((o: { status: string }) => PAID_STATUSES.has(o.status))]
  }

  // Detalhes em batches de 10
  const details = []
  for (let i = 0; i < Math.min(orders.length, 200); i += 10) {
    const batch = await Promise.all(
      orders.slice(i, i + 10).map(async (o: { orderId: string }) => {
        const r = await fetch(`https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders/${o.orderId}`, { headers })
        return r.ok ? r.json() : null
      })
    )
    details.push(...batch.filter(Boolean))
  }

  // Agrega por tamanho único
  interface SizeEntry {
    rawLiters: number
    packSize: number
    litersPerPack: number
    inPackRules: boolean
    totalPacks: number
    totalLiters: number
    exampleName: string
  }
  const sizeMap = new Map<string, SizeEntry>()
  let grandTotal = 0
  let itemsWithNoVolume: string[] = []

  for (const detail of details) {
    if (!detail?.items) continue
    for (const item of detail.items) {
      const raw = parseRawLiters(item.name ?? '')
      if (raw === 0) {
        if (!itemsWithNoVolume.includes(item.name)) itemsWithNoVolume.push(item.name)
        continue
      }
      const pack = getPackSize(raw)
      const litersPerPack = raw * pack
      const qty = item.quantity ?? 1
      const key = raw.toFixed(4)
      if (!sizeMap.has(key)) {
        sizeMap.set(key, {
          rawLiters: raw,
          packSize: pack,
          litersPerPack,
          inPackRules: PACK_RULES.some(r => Math.abs(r.liters - raw) < 0.01),
          totalPacks: 0,
          totalLiters: 0,
          exampleName: item.name,
        })
      }
      const entry = sizeMap.get(key)!
      entry.totalPacks += qty
      entry.totalLiters += litersPerPack * qty
      grandTotal += litersPerPack * qty
    }
  }

  const sizes = Array.from(sizeMap.values()).sort((a, b) => b.totalLiters - a.totalLiters)

  return NextResponse.json({
    dateFrom,
    dateTo,
    ordersAnalyzed: details.length,
    grandTotalL: Math.round(grandTotal * 100) / 100,
    sizes,
    itemsWithNoVolumeParsed: itemsWithNoVolume.slice(0, 20),
  })
}
