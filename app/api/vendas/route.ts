import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!

const headers = {
  'X-VTEX-API-AppKey': APP_KEY,
  'X-VTEX-API-AppToken': APP_TOKEN,
  'Content-Type': 'application/json',
}

interface OrderListItem {
  orderId: string
  clientName: string
  totalValue: number
  creationDate: string
  status: string
}

interface OrderDetail {
  orderId: string
  clientProfileData: { email: string; firstName: string; lastName: string }
  value: number
  creationDate: string
  status: string
}

async function fetchOrdersPage(dateFrom: string, dateTo: string, page: number): Promise<{ list: OrderListItem[]; total: number }> {
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?f_creationDate=creationDate:[${dateFrom}T00:00:00.000Z+TO+${dateTo}T23:59:59.999Z]&page=${page}&per_page=100`
  const res = await fetch(url, { headers })
  if (!res.ok) return { list: [], total: 0 }
  const data = await res.json()
  return { list: data.list ?? [], total: data.paging?.total ?? 0 }
}

async function fetchAllOrdersInPeriod(dateFrom: string, dateTo: string): Promise<OrderListItem[]> {
  const first = await fetchOrdersPage(dateFrom, dateTo, 1)
  const pages = Math.min(Math.ceil(first.total / 100), 20) // max 2000 orders
  if (pages <= 1) return first.list

  const remaining = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      fetchOrdersPage(dateFrom, dateTo, i + 2).then(r => r.list)
    )
  )
  return [...first.list, ...remaining.flat()]
}

async function fetchOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders/${orderId}`
  const res = await fetch(url, { headers })
  if (!res.ok) return null
  return res.json()
}

async function fetchTotalOrdersByEmail(email: string): Promise<number> {
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?q=${encodeURIComponent(email)}&per_page=1&page=1`
  const res = await fetch(url, { headers })
  if (!res.ok) return 0
  const data = await res.json()
  return data.paging?.total ?? 0
}

async function fetchOrdersBeforeDateByEmail(email: string, beforeDate: string): Promise<number> {
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?q=${encodeURIComponent(email)}&f_creationDate=creationDate:[2010-01-01T00:00:00.000Z+TO+${beforeDate}T23:59:59.999Z]&per_page=1&page=1`
  const res = await fetch(url, { headers })
  if (!res.ok) return 0
  const data = await res.json()
  return data.paging?.total ?? 0
}

async function batchProcess<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('from') ?? getDefaultFrom()
  const dateTo = searchParams.get('to') ?? getDefaultTo()

  try {
    // 1. Busca todos os pedidos do período
    const orders = await fetchAllOrdersInPeriod(dateFrom, dateTo)
    const totalOrders = orders.length
    const totalRevenue = orders.reduce((s, o) => s + (o.totalValue ?? 0) / 100, 0)

    // 2. Pega detalhes de pedidos únicos (limitado a 300 para performance)
    const sampleOrders = orders.slice(0, 300)
    const details = await batchProcess(sampleOrders, 15, (o) => fetchOrderDetail(o.orderId))

    // 3. Agrupa por email
    const byEmail = new Map<string, { name: string; orderCount: number; totalSpent: number; orderIds: string[] }>()
    for (const detail of details) {
      if (!detail?.clientProfileData?.email) continue
      const email = detail.clientProfileData.email.toLowerCase()
      const name = `${detail.clientProfileData.firstName} ${detail.clientProfileData.lastName}`.trim()
      if (!byEmail.has(email)) {
        byEmail.set(email, { name, orderCount: 0, totalSpent: 0, orderIds: [] })
      }
      const entry = byEmail.get(email)!
      entry.orderCount++
      entry.totalSpent += (detail.value ?? 0) / 100
      entry.orderIds.push(detail.orderId)
    }

    const uniqueEmails = Array.from(byEmail.keys())

    // 4. Para cada cliente, verifica se tem pedidos ANTES do período (recorrência)
    // e quantos pedidos totais tem
    const recurrenceData = await batchProcess(uniqueEmails, 10, async (email) => {
      const [totalAllTime, beforePeriod] = await Promise.all([
        fetchTotalOrdersByEmail(email),
        fetchOrdersBeforeDateByEmail(email, dateFrom),
      ])
      return { email, totalAllTime, isRecurring: beforePeriod > 0, ordersBeforePeriod: beforePeriod }
    })

    const recurrenceMap = new Map(recurrenceData.map(r => [r.email, r]))

    // 5. Monta lista de clientes com classificação
    const customers = uniqueEmails.map(email => {
      const info = byEmail.get(email)!
      const rec = recurrenceMap.get(email)
      return {
        email,
        name: info.name,
        ordersInPeriod: info.orderCount,
        totalSpent: info.totalSpent,
        totalAllTime: rec?.totalAllTime ?? info.orderCount,
        isRecurring: rec?.isRecurring ?? false,
        ordersBeforePeriod: rec?.ordersBeforePeriod ?? 0,
      }
    }).sort((a, b) => b.totalSpent - a.totalSpent)

    const recurringCustomers = customers.filter(c => c.isRecurring)
    const newCustomers = customers.filter(c => !c.isRecurring)

    return NextResponse.json({
      summary: {
        totalOrders,
        totalRevenue,
        uniqueCustomers: uniqueEmails.length,
        recurringCount: recurringCustomers.length,
        newCount: newCustomers.length,
        recurringRevenue: recurringCustomers.reduce((s, c) => s + c.totalSpent, 0),
        newRevenue: newCustomers.reduce((s, c) => s + c.totalSpent, 0),
        isSample: orders.length > 300,
        sampleSize: sampleOrders.length,
      },
      customers,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function getDefaultFrom() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

function getDefaultTo() {
  return new Date().toISOString().split('T')[0]
}
