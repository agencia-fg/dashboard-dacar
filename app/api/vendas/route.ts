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
  clientProfileData: { email: string; firstName: string; lastName: string; phone?: string }
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

// VTEX gera emails no formato: original@email.com-hash.ct.vtex.com.br
// Precisamos extrair o email original para buscar histórico corretamente
function extractRealEmail(email: string): string {
  if (!email.endsWith('.ct.vtex.com.br')) return email
  const withoutSuffix = email.replace(/\.ct\.vtex\.com\.br$/, '')
  const lastDash = withoutSuffix.lastIndexOf('-')
  if (lastDash === -1) return email
  return withoutSuffix.substring(0, lastDash)
}

async function fetchTotalOrdersByEmail(email: string): Promise<number> {
  const realEmail = extractRealEmail(email)
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?q=${encodeURIComponent(realEmail)}&per_page=1&page=1`
  const res = await fetch(url, { headers })
  if (!res.ok) return 0
  const data = await res.json()
  return data.paging?.total ?? 0
}


async function fetchRegistrationDate(email: string): Promise<string | null> {
  const realEmail = extractRealEmail(email)
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/search?_fields=createdIn&_where=email=${encodeURIComponent(realEmail)}&_sort=createdIn ASC`
  const res = await fetch(url, { headers: { ...headers, 'REST-Range': 'resources=0-0' } })
  if (!res.ok) return null
  const data = await res.json()
  return data?.[0]?.createdIn ?? null
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

    // 3. Agrupa por email + primeira data de pedido no período
    const byEmail = new Map<string, { name: string; phone: string; orderCount: number; totalSpent: number; firstOrderDate: string }>()
    for (const detail of details) {
      if (!detail?.clientProfileData?.email) continue
      const rawEmail = detail.clientProfileData.email.toLowerCase()
      const email = extractRealEmail(rawEmail)
      const name = `${detail.clientProfileData.firstName} ${detail.clientProfileData.lastName}`.trim()
      const phone = detail.clientProfileData.phone ?? ''
      const orderDate = detail.creationDate ?? ''
      if (!byEmail.has(email)) {
        byEmail.set(email, { name, phone, orderCount: 0, totalSpent: 0, firstOrderDate: orderDate })
      }
      const entry = byEmail.get(email)!
      if (!entry.phone && phone) entry.phone = phone
      if (orderDate && orderDate < entry.firstOrderDate) entry.firstOrderDate = orderDate
      entry.orderCount++
      entry.totalSpent += (detail.value ?? 0) / 100
    }

    const uniqueEmails = Array.from(byEmail.keys())

    // 4. Para cada cliente: histórico de pedidos + data de cadastro
    const enrichData = await batchProcess(uniqueEmails, 8, async (email) => {
      const [totalAllTime, registeredAt] = await Promise.all([
        fetchTotalOrdersByEmail(email),
        fetchRegistrationDate(email),
      ])
      const ordersInPeriod = byEmail.get(email)?.orderCount ?? 0
      const ordersBeforePeriod = Math.max(0, totalAllTime - ordersInPeriod)
      const firstOrderDate = byEmail.get(email)?.firstOrderDate ?? null

      // Dias entre cadastro e primeira compra (apenas para clientes novos)
      let daysToPurchase: number | null = null
      if (registeredAt && firstOrderDate && ordersBeforePeriod === 0) {
        const diff = new Date(firstOrderDate).getTime() - new Date(registeredAt).getTime()
        daysToPurchase = Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)))
      }

      return { email, totalAllTime, isRecurring: ordersBeforePeriod > 0, ordersBeforePeriod, registeredAt, daysToPurchase }
    })

    const enrichMap = new Map(enrichData.map(r => [r.email, r]))

    // 5. Monta lista de clientes com classificação
    const customers = uniqueEmails.map(email => {
      const info = byEmail.get(email)!
      const enrich = enrichMap.get(email)
      return {
        email,
        name: info.name,
        phone: info.phone,
        ordersInPeriod: info.orderCount,
        totalSpent: info.totalSpent,
        firstOrderDate: info.firstOrderDate,
        totalAllTime: enrich?.totalAllTime ?? info.orderCount,
        isRecurring: enrich?.isRecurring ?? false,
        ordersBeforePeriod: enrich?.ordersBeforePeriod ?? 0,
        registeredAt: enrich?.registeredAt ?? null,
        daysToPurchase: enrich?.daysToPurchase ?? null,
      }
    }).sort((a, b) => b.totalSpent - a.totalSpent)

    const recurringCustomers = customers.filter(c => c.isRecurring)
    const newCustomers = customers.filter(c => !c.isRecurring)
    const newWithDays = newCustomers.filter(c => c.daysToPurchase !== null)
    const avgDaysToPurchase = newWithDays.length > 0
      ? Math.round(newWithDays.reduce((s, c) => s + (c.daysToPurchase ?? 0), 0) / newWithDays.length)
      : null

    return NextResponse.json({
      summary: {
        totalOrders,
        totalRevenue,
        uniqueCustomers: uniqueEmails.length,
        recurringCount: recurringCustomers.length,
        newCount: newCustomers.length,
        recurringRevenue: recurringCustomers.reduce((s, c) => s + c.totalSpent, 0),
        newRevenue: newCustomers.reduce((s, c) => s + c.totalSpent, 0),
        avgDaysToPurchase,
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
