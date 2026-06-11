import { NextRequest, NextResponse } from 'next/server'
import { fetchAllCustomers, fetchOrdersForCustomers, VtexCustomer, VtexOrder } from '@/lib/vtex'

export const dynamic = 'force-dynamic'

const PAID_STATUSES = new Set([
  'payment-approved', 'invoiced', 'handling',
  'ready-for-handling', 'waiting-for-fulfillment',
  'shipped', 'delivered', 'order-completed',
])

// "Acessou" = voltou ao site após o cadastro. O lastInteractionIn é gravado no
// próprio ato de cadastro, então só conta como retorno se vier com folga depois.
const RETURN_VISIT_MARGIN_MS = 12 * 60 * 60 * 1000 // 12h

function getFunnelStage(
  orders: VtexOrder[],
  lastInteractionIn: string | null | undefined,
  createdIn: string | null | undefined,
  dateFrom: string,
  dateTo: string
): string {
  const dateFromMs = new Date(dateFrom + 'T00:00:00.000Z').getTime()
  const dateToMs   = new Date(dateTo   + 'T23:59:59.999Z').getTime()

  const periodOrders = orders.filter(o => {
    const t = new Date(o.creationDate).getTime()
    return t >= dateFromMs && t <= dateToMs
  })

  if (periodOrders.some(o => PAID_STATUSES.has(o.status))) return 'Comprou'
  if (periodOrders.some(o => o.status !== 'canceled' && o.status !== 'unknown')) return 'Chegou ao pagamento'
  if (periodOrders.length > 0) return 'Iniciou pedido'

  if (lastInteractionIn && createdIn) {
    const interaction = new Date(lastInteractionIn).getTime()
    const created = new Date(createdIn).getTime()
    if (interaction > created + RETURN_VISIT_MARGIN_MS && interaction >= dateFromMs && interaction <= dateToMs) {
      return 'Acessou'
    }
  }

  return 'Só cadastrou'
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('from') ?? getDefaultFrom()
  const dateTo = searchParams.get('to') ?? getDefaultTo()

  try {
    const customers = await fetchAllCustomers(dateFrom, dateTo)
    const ordersByEmail = await fetchOrdersForCustomers(customers)

    const enriched = customers.map((c) => {
      const customerOrders = ordersByEmail.get(c.email?.toLowerCase()) ?? []
      const totalSpent = customerOrders.reduce((sum, o) => sum + (o.totalValue ?? o.value ?? 0) / 100, 0)
      const paidSpent = customerOrders
        .filter(o => PAID_STATUSES.has(o.status))
        .reduce((sum, o) => sum + (o.totalValue ?? o.value ?? 0) / 100, 0)
      const firstPurchaseDate =
        customerOrders.length > 0
          ? customerOrders.sort(
              (a, b) => new Date(a.creationDate).getTime() - new Date(b.creationDate).getTime()
            )[0].creationDate
          : null
      const funnelStage = getFunnelStage(customerOrders, c.lastInteractionIn, c.createdIn, dateFrom, dateTo)

      return {
        ...c,
        orders: customerOrders,
        totalSpent,
        paidSpent,
        firstPurchaseDate,
        purchased: customerOrders.some(o => PAID_STATUSES.has(o.status)),
        funnelStage,
      }
    })

    const totalCustomers = enriched.length
    const purchasedCustomers = enriched.filter((c) => c.purchased)
    const neverPurchased = enriched.filter((c) => !c.purchased)
    const approvedCustomers = customers.filter((c) => c.approved === true)
    const conversionRate =
      totalCustomers > 0 ? (purchasedCustomers.length / totalCustomers) * 100 : 0

    const byDay = buildDailyMap(enriched, dateFrom, dateTo)

    return NextResponse.json({
      summary: {
        totalCustomers,
        approvedCount: approvedCustomers.length,
        purchasedCount: purchasedCustomers.length,
        neverPurchasedCount: neverPurchased.length,
        conversionRate: parseFloat(conversionRate.toFixed(1)),
        totalRevenue: enriched.reduce((s, c) => s + c.totalSpent, 0),
        paidRevenue: enriched.reduce((s, c) => s + c.paidSpent, 0),
      },
      byDay,
      customers: enriched.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        createdIn: c.createdIn,
        purchased: c.purchased,
        orderCount: c.orders.length,
        totalSpent: c.totalSpent,
        paidSpent: c.paidSpent,
        firstPurchaseDate: c.firstPurchaseDate,
        funnelStage: c.funnelStage,
        lastInteractionIn: c.lastInteractionIn ?? null,
        approved: c.approved ?? null,
      })),
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


function buildDailyMap(
  customers: Array<{ createdIn: string; purchased: boolean }>,
  dateFrom: string,
  dateTo: string
) {
  const map = new Map<string, { registrations: number; purchases: number }>()

  const from = new Date(dateFrom)
  const to = new Date(dateTo)
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0]
    map.set(key, { registrations: 0, purchases: 0 })
  }

  for (const c of customers) {
    const key = c.createdIn?.split('T')[0]
    if (key && map.has(key)) {
      const entry = map.get(key)!
      entry.registrations++
      if (c.purchased) entry.purchases++
    }
  }

  return Array.from(map.entries()).map(([date, v]) => ({ date, ...v }))
}
