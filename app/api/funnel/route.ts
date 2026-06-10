import { NextRequest, NextResponse } from 'next/server'
import { fetchAllCustomers } from '@/lib/vtex'

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

async function fetchOrdersAllStatuses(
  dateFrom: string,
  dateTo: string,
  page = 1
): Promise<{ list: Array<{ clientName: string; status: string; totalValue: number }>; total: number }> {
  // Sem filtro de status — busca TODOS (inclusive cancelados, payment-pending, etc.)
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?f_creationDate=creationDate:[${dateFrom}T00:00:00.000Z+TO+${dateTo}T23:59:59.999Z]&page=${page}&per_page=100`
  const res = await fetch(url, { headers })
  if (!res.ok) return { list: [], total: 0 }
  const data = await res.json()
  return { list: data.list ?? [], total: data.paging?.total ?? 0 }
}

async function fetchAllOrdersAllStatuses(dateFrom: string, dateTo: string) {
  const first = await fetchOrdersAllStatuses(dateFrom, dateTo, 1)
  const pages = Math.min(Math.ceil(first.total / 100), 20)
  if (pages <= 1) return first.list
  const remaining = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      fetchOrdersAllStatuses(dateFrom, dateTo, i + 2).then(r => r.list)
    )
  )
  return [...first.list, ...remaining.flat()]
}

// Busca emails de pedidos via detalhes (necessário pois a listagem não retorna email)
// Para o funil usamos clientName como proxy de cliente único
function countUniqueClients(orders: Array<{ clientName: string }>) {
  return new Set(orders.map(o => o.clientName?.toLowerCase().trim()).filter(Boolean)).size
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('from') ?? getDefaultFrom()
  const dateTo = searchParams.get('to') ?? getDefaultTo()

  const PAYMENT_PENDING_STATUSES = new Set([
    'payment-pending', 'waiting-for-authorization', 'approve',
  ])

  try {
    const [customers, allOrders] = await Promise.all([
      fetchAllCustomers(dateFrom, dateTo),
      fetchAllOrdersAllStatuses(dateFrom, dateTo),
    ])

    const totalRegistrations = customers.length

    // Quem acessou no período (lastInteractionIn dentro do range)
    const dateFromMs = new Date(dateFrom + 'T00:00:00.000Z').getTime()
    const dateToMs   = new Date(dateTo   + 'T23:59:59.999Z').getTime()
    const accessedCount = customers.filter(c => {
      if (!c.lastInteractionIn) return false
      const t = new Date(c.lastInteractionIn).getTime()
      return t >= dateFromMs && t <= dateToMs
    }).length

    // Quem iniciou qualquer pedido no período
    const anyOrderClients = countUniqueClients(allOrders.filter(o => o.clientName))

    // Quem chegou ao pagamento (payment-pending ou acima, exceto cancelados)
    const paymentOrders = allOrders.filter(o =>
      o.status !== 'canceled' && o.status !== 'unknown' && o.clientName
    )
    const paymentUniqueClients = countUniqueClients(paymentOrders)

    // Quem efetivamente comprou
    const paidOrders = allOrders.filter(o => PAID_STATUSES.has(o.status))
    const paidUniqueClients = countUniqueClients(paidOrders)
    const paidRevenue = paidOrders.reduce((s, o) => s + (o.totalValue ?? 0) / 100, 0)

    const statusBreakdown: Record<string, number> = {}
    for (const o of allOrders) {
      statusBreakdown[o.status] = (statusBreakdown[o.status] ?? 0) + 1
    }

    const funnel = [
      {
        step: 'Cadastros',
        label: 'Cadastrados no período',
        count: totalRegistrations,
        color: '#3b82f6',
        pct: undefined,
      },
      {
        step: 'Acessaram',
        label: 'Acessaram o site',
        count: accessedCount,
        color: '#8b5cf6',
        pct: totalRegistrations > 0 ? (accessedCount / totalRegistrations) * 100 : 0,
      },
      {
        step: 'Pedido',
        label: 'Iniciaram pedido',
        count: anyOrderClients,
        color: '#f59e0b',
        pct: accessedCount > 0 ? (anyOrderClients / accessedCount) * 100 : 0,
      },
      {
        step: 'Pagamento',
        label: 'Chegaram ao pagamento',
        count: paymentUniqueClients,
        color: '#f97316',
        pct: anyOrderClients > 0 ? (paymentUniqueClients / anyOrderClients) * 100 : 0,
      },
      {
        step: 'Compra',
        label: 'Compraram',
        count: paidUniqueClients,
        color: '#10b981',
        pct: paymentUniqueClients > 0 ? (paidUniqueClients / paymentUniqueClients) * 100 : 0,
      },
    ]

    return NextResponse.json({
      funnel,
      paidRevenue,
      totalOrders: allOrders.length,
      statusBreakdown,
      conversionRate: totalRegistrations > 0
        ? parseFloat(((paidUniqueClients / totalRegistrations) * 100).toFixed(1))
        : 0,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function getDefaultFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}

function getDefaultTo() {
  return new Date().toISOString().split('T')[0]
}
