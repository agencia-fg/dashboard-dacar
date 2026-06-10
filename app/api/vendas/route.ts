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

// Status considerados como "pago"
const PAID_STATUSES = new Set([
  'payment-approved', 'invoiced', 'handling',
  'ready-for-handling', 'waiting-for-fulfillment',
  'shipped', 'delivered', 'order-completed',
])

interface OrderListItem {
  orderId: string
  clientName: string
  totalValue: number
  creationDate: string
  status: string
}

interface MarketingData {
  utmSource?: string; utmMedium?: string; utmCampaign?: string
}

interface OrderItem {
  name: string
  quantity: number
  sellingPrice: number
}

interface OrderDetail {
  orderId: string
  clientProfileData: { email: string; firstName: string; lastName: string; phone?: string }
  value: number
  creationDate: string
  status: string
  marketingData?: MarketingData
  shippingData?: { selectedAddresses?: Array<{ city?: string; state?: string }> }
  items?: OrderItem[]
}

// Kg → L (densidade ~1 para tintas base água / borracha líquida Dacar)
const KG_TO_LITERS = 1.0

// Regras de embalagem: tamanhos vendidos em pacote com N unidades
// A quantidade VTEX (item.quantity) representa número de PACOTES
// Portanto: litros totais = litrosDoItem × unidadesPorPacote × item.quantity
const PACK_RULES: Array<{ liters: number; packSize: number }> = [
  // Unitários
  { liters: 18,     packSize: 1 },
  { liters: 16,     packSize: 1 },
  { liters: 15,     packSize: 1 },
  { liters: 24,     packSize: 1 },
  { liters: 20,     packSize: 1 },
  // Pacotes de 4
  { liters: 3.6,    packSize: 4 },
  { liters: 5.7,    packSize: 4 },
  { liters: 5.8,    packSize: 4 }, // Cimento Queimado 5,8 Kg
  // Pacotes de 6
  { liters: 5,      packSize: 6 },
  { liters: 1.4,    packSize: 6 },
  { liters: 0.9,    packSize: 6 }, // 900ml ou 0,9L
  // Pacotes de 12
  { liters: 0.225,  packSize: 12 }, // 225ml
  { liters: 0.1125, packSize: 12 }, // 112,5ml
]

function getPackSize(liters: number): number {
  const match = PACK_RULES.find(r => Math.abs(r.liters - liters) < 0.01)
  return match?.packSize ?? 1 // default unitário se não encontrado
}

// Extrai litros por UNIDADE do produto (antes de multiplicar por item.quantity)
// Depois aplica o multiplicador de pacote
// Case-insensitive. Cobre: 3,6 L / 3.6L / 18 Lt / 18 LT / 18 Litros / 900ml / 20 Kg
function parseVolumeFromName(name: string): number {
  let litersPerUnit = 0

  // Mililitros: ml (separado para /1000 sem colidir com L)
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*ml\b/gi)]) {
    litersPerUnit += parseFloat(m[1].replace(',', '.')) / 1000
  }

  // Litros: L, Lt, Lts, Litro, Litros
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?|l)\b/gi)]) {
    const idx = m.index ?? 0
    if (idx > 0 && name[idx - 1].toLowerCase() === 'm') continue // já contado como ml
    litersPerUnit += parseFloat(m[1].replace(',', '.'))
  }

  // Kg → L
  for (const m of [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*kgs?\b/gi)]) {
    litersPerUnit += parseFloat(m[1].replace(',', '.')) * KG_TO_LITERS
  }

  const packSize = getPackSize(litersPerUnit)
  return litersPerUnit * packSize
}

interface CustomerProfile {
  createdIn: string | null
  corporateDocument: string | null
  corporateName: string | null
  tradeName: string | null
  city: string | null
  state: string | null
  approved: boolean | null
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
  const pages = Math.min(Math.ceil(first.total / 100), 20)
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

function extractRealEmail(email: string): string {
  if (!email.endsWith('.ct.vtex.com.br')) return email
  const withoutSuffix = email.replace(/\.ct\.vtex\.com\.br$/, '')
  const lastDash = withoutSuffix.lastIndexOf('-')
  if (lastDash === -1) return email
  return withoutSuffix.substring(0, lastDash)
}

async function fetchTotalOrdersByEmail(email: string): Promise<{ total: number; firstOrderDate: string | null; lastOrderDateAllTime: string | null }> {
  const realEmail = extractRealEmail(email)
  const [latestRes, firstRes] = await Promise.all([
    // ordenação padrão é desc — primeiro resultado é o mais recente
    fetch(`https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?q=${encodeURIComponent(realEmail)}&per_page=1&page=1`, { headers }),
    fetch(`https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?q=${encodeURIComponent(realEmail)}&per_page=1&page=1&orderBy=creationDate,asc`, { headers }),
  ])
  const latestData = latestRes.ok ? await latestRes.json() : null
  const total = latestData?.paging?.total ?? 0
  const lastOrderDateAllTime = latestData?.list?.[0]?.creationDate ?? null
  const firstData = firstRes.ok ? await firstRes.json() : null
  const firstOrderDate = firstData?.list?.[0]?.creationDate ?? null
  return { total, firstOrderDate, lastOrderDateAllTime }
}

async function fetchCustomerProfile(email: string): Promise<CustomerProfile> {
  const realEmail = extractRealEmail(email)
  const fields = 'createdIn,corporateDocument,corporateName,tradeName,city,state,approved'
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/search?_fields=${fields}&email=${encodeURIComponent(realEmail)}`
  const res = await fetch(url, { headers: { ...headers, 'REST-Range': 'resources=0-1' } })
  if (!res.ok) return { createdIn: null, corporateDocument: null, corporateName: null, tradeName: null, city: null, state: null, approved: null }
  const data = await res.json()
  const r = data?.[0]
  return {
    createdIn: r?.createdIn ?? null,
    corporateDocument: r?.corporateDocument ?? null,
    corporateName: r?.corporateName ?? null,
    tradeName: r?.tradeName ?? null,
    city: r?.city ?? null,
    state: r?.state ?? null,
    approved: r?.approved ?? null,
  }
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
    const totalRevenueCaptada = orders.reduce((s, o) => s + (o.totalValue ?? 0) / 100, 0)
    const totalRevenuePaga = orders
      .filter(o => PAID_STATUSES.has(o.status))
      .reduce((s, o) => s + (o.totalValue ?? 0) / 100, 0)

    // 2. Pega detalhes (limitado a 300)
    const sampleOrders = orders.slice(0, 300)
    const details = await batchProcess(sampleOrders, 15, (o) => fetchOrderDetail(o.orderId))

    // 3. Agrupa por email
    const byEmail = new Map<string, {
      name: string; phone: string; orderCount: number
      totalSpent: number; paidSpent: number
      firstOrderDate: string; lastOrderDate: string
      lastUtm: MarketingData | null
      city: string | null; state: string | null
      paidVolumeL: number  // apenas pedidos pagos, Kg já convertido para L
    }>()

    for (const detail of details) {
      if (!detail?.clientProfileData?.email) continue
      const rawEmail = detail.clientProfileData.email.toLowerCase()
      const email = extractRealEmail(rawEmail)
      const name = `${detail.clientProfileData.firstName} ${detail.clientProfileData.lastName}`.trim()
      const phone = detail.clientProfileData.phone ?? ''
      const orderDate = detail.creationDate ?? ''
      const isPaid = PAID_STATUSES.has(detail.status)
      const city = detail.shippingData?.selectedAddresses?.[0]?.city ?? null
      const state = detail.shippingData?.selectedAddresses?.[0]?.state ?? null

      // Soma volume apenas de pedidos PAGOS (Kg já convertido para L)
      let orderVolumeL = 0
      if (isPaid) {
        for (const item of detail.items ?? []) {
          const vol = parseVolumeFromName(item.name ?? '')
          orderVolumeL += vol * (item.quantity ?? 1)
        }
      }

      if (!byEmail.has(email)) {
        byEmail.set(email, { name, phone, orderCount: 0, totalSpent: 0, paidSpent: 0, firstOrderDate: orderDate, lastOrderDate: orderDate, lastUtm: null, city, state, paidVolumeL: 0 })
      }
      const entry = byEmail.get(email)!
      if (!entry.phone && phone) entry.phone = phone
      if (!entry.city && city) entry.city = city
      if (!entry.state && state) entry.state = state
      if (orderDate && orderDate < entry.firstOrderDate) entry.firstOrderDate = orderDate
      if (orderDate && orderDate > entry.lastOrderDate) {
        entry.lastOrderDate = orderDate
        if (detail.marketingData) entry.lastUtm = detail.marketingData
      }
      entry.orderCount++
      entry.totalSpent += (detail.value ?? 0) / 100
      if (isPaid) entry.paidSpent += (detail.value ?? 0) / 100
      entry.paidVolumeL += orderVolumeL
    }

    const uniqueEmails = Array.from(byEmail.keys())

    // 4. Enriquece com histórico + cadastro
    const enrichData = await batchProcess(uniqueEmails, 8, async (email) => {
      const [orderInfo, profile] = await Promise.all([
        fetchTotalOrdersByEmail(email),
        fetchCustomerProfile(email),
      ])
      const registeredAt = profile.createdIn
      const { total: totalAllTime, firstOrderDate: firstOrderDateAllTime, lastOrderDateAllTime } = orderInfo
      const ordersInPeriod = byEmail.get(email)?.orderCount ?? 0
      const ordersBeforePeriod = Math.max(0, totalAllTime - ordersInPeriod)

      let daysToPurchase: number | null = null
      if (registeredAt && firstOrderDateAllTime) {
        const diff = new Date(firstOrderDateAllTime).getTime() - new Date(registeredAt).getTime()
        daysToPurchase = Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)))
      }

      // Frequência média: (última - primeira) / (total - 1)
      let avgDaysBetweenOrders: number | null = null
      if (totalAllTime >= 2 && firstOrderDateAllTime && lastOrderDateAllTime) {
        const span = new Date(lastOrderDateAllTime).getTime() - new Date(firstOrderDateAllTime).getTime()
        avgDaysBetweenOrders = Math.max(1, Math.round(span / (1000 * 60 * 60 * 24) / (totalAllTime - 1)))
      }

      return { email, totalAllTime, isRecurring: ordersBeforePeriod > 0, ordersBeforePeriod, registeredAt, daysToPurchase, firstOrderDateAllTime, avgDaysBetweenOrders, profile }
    })

    const enrichMap = new Map(enrichData.map(r => [r.email, r]))

    // 5. Monta lista final
    const customers = uniqueEmails.map(email => {
      const info = byEmail.get(email)!
      const enrich = enrichMap.get(email)
      const utm = info.lastUtm
      return {
        email,
        name: info.name,
        phone: info.phone,
        ordersInPeriod: info.orderCount,
        totalSpent: info.totalSpent,
        paidSpent: info.paidSpent,
        firstOrderDate: enrich?.firstOrderDateAllTime ?? info.firstOrderDate,
        lastOrderDate: info.lastOrderDate,
        totalAllTime: enrich?.totalAllTime ?? info.orderCount,
        isRecurring: enrich?.isRecurring ?? false,
        ordersBeforePeriod: enrich?.ordersBeforePeriod ?? 0,
        registeredAt: enrich?.registeredAt ?? null,
        daysToPurchase: enrich?.daysToPurchase ?? null,
        avgDaysBetweenOrders: enrich?.avgDaysBetweenOrders ?? null,
        cnpj: enrich?.profile?.corporateDocument ?? null,
        corporateName: enrich?.profile?.corporateName ?? null,
        tradeName: enrich?.profile?.tradeName ?? null,
        city: info.city ?? enrich?.profile?.city ?? null,
        state: info.state ?? enrich?.profile?.state ?? null,
        approved: enrich?.profile?.approved ?? null,
        utmSource: utm?.utmSource ?? null,
        utmMedium: utm?.utmMedium ?? null,
        utmCampaign: utm?.utmCampaign ?? null,
        paidVolumeL: Math.round((info.paidVolumeL ?? 0) * 100) / 100,
      }
    }).sort((a, b) => b.totalSpent - a.totalSpent)

    const recurringCustomers = customers.filter(c => c.isRecurring)
    const newCustomers = customers.filter(c => !c.isRecurring)
    const paidCustomers = customers.filter(c => c.paidSpent > 0)

    // Breakdown por estado
    const byState = new Map<string, { count: number; newCount: number; recurringCount: number; revenue: number; paidRevenue: number; orders: number; paidOrders: number; paidVolumeL: number }>()
    for (const c of customers) {
      const s = c.state ?? 'Não informado'
      if (!byState.has(s)) byState.set(s, { count: 0, newCount: 0, recurringCount: 0, revenue: 0, paidRevenue: 0, orders: 0, paidOrders: 0, paidVolumeL: 0 })
      const e = byState.get(s)!
      e.count++
      if (c.isRecurring) e.recurringCount++; else e.newCount++
      e.revenue += c.totalSpent
      e.paidRevenue += c.paidSpent
      e.orders += c.ordersInPeriod
      e.paidOrders += c.paidSpent > 0 ? c.ordersInPeriod : 0
      e.paidVolumeL += c.paidVolumeL
    }
    const regionData = Array.from(byState.entries())
      .map(([state, v]) => ({
        state, ...v,
        avgTicket: v.orders > 0 ? Math.round(v.revenue / v.orders * 100) / 100 : 0,
        avgPaidTicket: v.paidOrders > 0 ? Math.round(v.paidRevenue / v.paidOrders * 100) / 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
    const newWithDays = newCustomers.filter(c => c.daysToPurchase !== null)
    const avgDaysToPurchase = newWithDays.length > 0
      ? Math.round(newWithDays.reduce((s, c) => s + (c.daysToPurchase ?? 0), 0) / newWithDays.length)
      : null

    const totalPaidVolumeL   = Math.round(customers.reduce((s, c) => s + c.paidVolumeL, 0) * 100) / 100
    const recurringPaidVolL  = Math.round(recurringCustomers.reduce((s, c) => s + c.paidVolumeL, 0) * 100) / 100
    const newPaidVolL        = Math.round(newCustomers.reduce((s, c) => s + c.paidVolumeL, 0) * 100) / 100

    return NextResponse.json({
      summary: {
        totalOrders,
        totalRevenueCaptada,
        totalRevenuePaga,
        uniqueCustomers: uniqueEmails.length,
        recurringCount: recurringCustomers.length,
        newCount: newCustomers.length,
        recurringRevenue: recurringCustomers.reduce((s, c) => s + c.totalSpent, 0),
        recurringPaidRevenue: recurringCustomers.reduce((s, c) => s + c.paidSpent, 0),
        newRevenue: newCustomers.reduce((s, c) => s + c.totalSpent, 0),
        newPaidRevenue: newCustomers.reduce((s, c) => s + c.paidSpent, 0),
        avgDaysToPurchase,
        paidCustomersCount: paidCustomers.length,
        isSample: orders.length > 300,
        sampleSize: sampleOrders.length,
        totalPaidVolumeL,
        recurringPaidVolumeL: recurringPaidVolL,
        newPaidVolumeL: newPaidVolL,
      },
      customers,
      regionData,
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
