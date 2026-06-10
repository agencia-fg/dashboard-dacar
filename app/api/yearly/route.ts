import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!
const h = { 'X-VTEX-API-AppKey': APP_KEY, 'X-VTEX-API-AppToken': APP_TOKEN, 'Content-Type': 'application/json' }

const PAID = new Set(['payment-approved','invoiced','handling','ready-for-handling','waiting-for-fulfillment','shipped','delivered','order-completed'])
const KG_TO_L = 1.0
const PACK_RULES = [
  { l: 18, p: 1 }, { l: 16, p: 1 }, { l: 15, p: 1 }, { l: 24, p: 1 }, { l: 20, p: 1 },
  { l: 3.6, p: 4 }, { l: 5.7, p: 4 }, { l: 5.8, p: 4 },
  { l: 5, p: 6 }, { l: 1.4, p: 6 }, { l: 0.9, p: 6 },
  { l: 0.225, p: 12 }, { l: 0.1125, p: 12 },
]
function packSize(l: number) { return PACK_RULES.find(r => Math.abs(r.l - l) < 0.01)?.p ?? 1 }
function parseVol(name: string): number {
  let v = 0
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*ml\b/gi)]) v += parseFloat(m[1].replace(',','.')) / 1000
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?|l)\b/gi)]) {
    const idx = m.index ?? 0; if (idx > 0 && name[idx-1].toLowerCase() === 'm') continue
    v += parseFloat(m[1].replace(',','.'))
  }
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*kgs?\b/gi)]) v += parseFloat(m[1].replace(',','.')) * KG_TO_L
  return v
}
function itemVol(name: string): number { const r = parseVol(name); return r * packSize(r) }

interface OListItem { orderId: string; clientName: string; totalValue: number; creationDate: string; status: string }

async function fetchYearOrders(year: number): Promise<OListItem[]> {
  const from = `${year}-01-01`, to = `${year}-12-31`
  const url = (p: number) => `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?f_creationDate=creationDate:[${from}T00:00:00.000Z+TO+${to}T23:59:59.999Z]&page=${p}&per_page=100`
  const first = await fetch(url(1), { headers: h }); if (!first.ok) return []
  const d = await first.json()
  const pages = Math.min(Math.ceil((d.paging?.total ?? 0) / 100), 20)
  if (pages <= 1) return d.list ?? []
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) =>
    fetch(url(i + 2), { headers: h }).then(r => r.ok ? r.json().then((j: { list?: OListItem[] }) => j.list ?? []) : [])
  ))
  return [...(d.list ?? []), ...rest.flat()]
}

async function fetchDetails(orderIds: string[]): Promise<Map<string, number>> {
  const volMap = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 10) {
    const batch = await Promise.all(
      orderIds.slice(i, i + 10).map(id =>
        fetch(`https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders/${id}`, { headers: h })
          .then(r => r.ok ? r.json() : null)
      )
    )
    for (const detail of batch) {
      if (!detail?.orderId) continue
      let vol = 0
      for (const item of detail.items ?? []) vol += itemVol(item.name ?? '') * (item.quantity ?? 1)
      volMap.set(detail.orderId, vol)
    }
  }
  return volMap
}

const PT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

interface MonthRow {
  month: number; label: string
  curRevenue: number; prevRevenue: number
  curNew: number; prevNew: number
  curRecurring: number; prevRecurring: number
  curVolumeL: number; prevVolumeL: number
}

export async function GET() {
  const now = new Date()
  const curYear = now.getFullYear()
  const prevYear = curYear - 1

  // Fetch both years in parallel
  const [curOrders, prevOrders] = await Promise.all([
    fetchYearOrders(curYear),
    fetchYearOrders(prevYear),
  ])

  // Build first-seen map (clientName proxy) across BOTH years for new/recurring
  const allSorted = [...prevOrders, ...curOrders]
    .filter(o => PAID.has(o.status) && o.clientName)
    .sort((a, b) => new Date(a.creationDate).getTime() - new Date(b.creationDate).getTime())

  const firstSeen = new Map<string, string>() // clientName -> orderId of first purchase
  for (const o of allSorted) {
    const key = o.clientName.toLowerCase().trim()
    if (!firstSeen.has(key)) firstSeen.set(key, o.orderId)
  }

  // Fetch details for volume (paid orders only, cap at 200/year)
  const curPaid = curOrders.filter(o => PAID.has(o.status)).slice(0, 200)
  const prevPaid = prevOrders.filter(o => PAID.has(o.status)).slice(0, 200)
  const [curVolMap, prevVolMap] = await Promise.all([
    fetchDetails(curPaid.map(o => o.orderId)),
    fetchDetails(prevPaid.map(o => o.orderId)),
  ])

  // Aggregate into 12 monthly buckets
  function aggregate(orders: OListItem[], volMap: Map<string, number>) {
    const months = Array.from({ length: 12 }, (_, i) => ({
      revenue: 0, newCount: 0, recurringCount: 0, volumeL: 0, seen: new Set<string>()
    }))
    for (const o of orders) {
      if (!PAID.has(o.status)) continue
      const m = new Date(o.creationDate).getMonth() // 0-11
      months[m].revenue += (o.totalValue ?? 0) / 100
      const vol = volMap.get(o.orderId) ?? 0
      months[m].volumeL += vol
      const key = o.clientName?.toLowerCase().trim() ?? ''
      if (!months[m].seen.has(key)) {
        months[m].seen.add(key)
        if (firstSeen.get(key) === o.orderId) months[m].newCount++
        else months[m].recurringCount++
      }
    }
    return months
  }

  const cur  = aggregate(curOrders, curVolMap)
  const prev = aggregate(prevOrders, prevVolMap)

  const rows: MonthRow[] = PT_MONTHS.map((label, i) => ({
    month: i + 1, label,
    curRevenue:    Math.round(cur[i].revenue * 100) / 100,
    prevRevenue:   Math.round(prev[i].revenue * 100) / 100,
    curNew:        cur[i].newCount,
    prevNew:       prev[i].newCount,
    curRecurring:  cur[i].recurringCount,
    prevRecurring: prev[i].recurringCount,
    curVolumeL:    Math.round(cur[i].volumeL * 10) / 10,
    prevVolumeL:   Math.round(prev[i].volumeL * 10) / 10,
  }))

  return NextResponse.json({ curYear, prevYear, months: rows })
}
