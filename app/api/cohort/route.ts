import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!
const h = { 'X-VTEX-API-AppKey': APP_KEY, 'X-VTEX-API-AppToken': APP_TOKEN, 'Content-Type': 'application/json' }

const PAID = new Set(['payment-approved','invoiced','handling','ready-for-handling','waiting-for-fulfillment','shipped','delivered','order-completed'])

interface OListItem { orderId: string; clientName: string; totalValue: number; creationDate: string; status: string }

async function fetchMonthOrders(year: number, month: number): Promise<OListItem[]> {
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  const from = `${year}-${pad(month)}-01`
  const to   = `${year}-${pad(month)}-${lastDay}`
  const url = (p: number) =>
    `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?f_creationDate=creationDate:[${from}T00:00:00.000Z+TO+${to}T23:59:59.999Z]&page=${p}&per_page=100`
  const first = await fetch(url(1), { headers: h }); if (!first.ok) return []
  const d = await first.json()
  const pages = Math.min(Math.ceil((d.paging?.total ?? 0) / 100), 10)
  if (pages <= 1) return d.list ?? []
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) =>
    fetch(url(i + 2), { headers: h }).then(r => r.ok ? r.json().then((j: { list?: OListItem[] }) => j.list ?? []) : [])
  ))
  return [...(d.list ?? []), ...rest.flat()]
}

const PT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

export async function GET() {
  const now = new Date()
  const curYear  = now.getFullYear()
  const curMonth = now.getMonth() + 1 // 1-12

  // Build list of last 12 months (most recent first)
  const months: { year: number; month: number }[] = []
  for (let i = 0; i < 12; i++) {
    let m = curMonth - i; let y = curYear
    if (m <= 0) { m += 12; y-- }
    months.push({ year: y, month: m })
  }
  months.reverse() // oldest first

  // Fetch all months in parallel
  const ordersByMonth = await Promise.all(months.map(({ year, month }) => fetchMonthOrders(year, month)))

  // Build a map: clientName -> sorted list of months they purchased (paid only)
  const clientMonths = new Map<string, Set<string>>() // clientName -> Set of "YYYY-MM"
  for (let i = 0; i < months.length; i++) {
    const { year, month } = months[i]
    const key = `${year}-${String(month).padStart(2, '0')}`
    for (const o of ordersByMonth[i]) {
      if (!PAID.has(o.status) || !o.clientName) continue
      const name = o.clientName.toLowerCase().trim()
      if (!clientMonths.has(name)) clientMonths.set(name, new Set())
      clientMonths.get(name)!.add(key)
    }
  }

  // For each cohort month, find new customers (first purchase in that month)
  // Then track how many returned in subsequent months
  const cohorts = months.map(({ year, month }, cohortIdx) => {
    const cohortKey = `${year}-${String(month).padStart(2, '0')}`
    const label = `${PT_MONTHS[month - 1]}/${String(year).slice(2)}`

    // New customers: those whose earliest purchase is in this cohort month
    const newCustomers: string[] = []
    for (const [name, mSet] of clientMonths) {
      const sorted = [...mSet].sort()
      if (sorted[0] === cohortKey) newCustomers.push(name)
    }
    const size = newCustomers.length

    // For each subsequent month (M+0, M+1, ... up to end), count how many returned
    const retention: (number | null)[] = []
    for (let offset = 0; offset < months.length - cohortIdx; offset++) {
      const targetIdx = cohortIdx + offset
      const { year: ty, month: tm } = months[targetIdx]
      const targetKey = `${ty}-${String(tm).padStart(2, '0')}`
      if (offset === 0) {
        retention.push(100) // M+0 is always 100%
      } else {
        const returned = newCustomers.filter(name => clientMonths.get(name)?.has(targetKey)).length
        retention.push(size > 0 ? Math.round((returned / size) * 100) : 0)
      }
    }
    // Pad with nulls for future months
    while (retention.length < months.length) retention.push(null)

    return { label, cohortKey, size, retention }
  })

  // Month offset labels: M+0, M+1, ...
  const offsets = months.map((_, i) => (i === 0 ? 'M+0' : `M+${i}`))

  return NextResponse.json({ cohorts, offsets, months: months.map(({ year, month }) => `${PT_MONTHS[month-1]}/${String(year).slice(2)}`) })
}
