import { NextRequest, NextResponse } from 'next/server'
import { fetchAllCustomers, fetchOrdersInPeriod, VtexCustomer, VtexOrder } from '@/lib/vtex'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('from') ?? getDefaultFrom()
  const dateTo = searchParams.get('to') ?? getDefaultTo()

  try {
    const [customers, orders] = await Promise.all([
      fetchAllCustomers(dateFrom, dateTo),
      fetchOrdersInPeriod(dateFrom, dateTo),
    ])

    const ordersByEmail = new Map<string, VtexOrder[]>()
    for (const order of orders) {
      const email = order.clientProfileData?.email?.toLowerCase()
      if (!email) continue
      if (!ordersByEmail.has(email)) ordersByEmail.set(email, [])
      ordersByEmail.get(email)!.push(order)
    }

    const enriched = customers.map((c) => {
      const customerOrders = ordersByEmail.get(c.email?.toLowerCase()) ?? []
      const totalSpent = customerOrders.reduce((sum, o) => sum + (o.value ?? 0) / 100, 0)
      const firstPurchaseDate =
        customerOrders.length > 0
          ? customerOrders.sort(
              (a, b) => new Date(a.creationDate).getTime() - new Date(b.creationDate).getTime()
            )[0].creationDate
          : null

      return {
        ...c,
        orders: customerOrders,
        totalSpent,
        firstPurchaseDate,
        purchased: customerOrders.length > 0,
      }
    })

    const totalCustomers = enriched.length
    const purchasedCustomers = enriched.filter((c) => c.purchased)
    const neverPurchased = enriched.filter((c) => !c.purchased)
    const conversionRate =
      totalCustomers > 0 ? (purchasedCustomers.length / totalCustomers) * 100 : 0

    // Registration by day
    const byDay = buildDailyMap(enriched, dateFrom, dateTo)

    return NextResponse.json({
      summary: {
        totalCustomers,
        purchasedCount: purchasedCustomers.length,
        neverPurchasedCount: neverPurchased.length,
        conversionRate: parseFloat(conversionRate.toFixed(1)),
        totalRevenue: purchasedCustomers.reduce((s, c) => s + c.totalSpent, 0),
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
        firstPurchaseDate: c.firstPurchaseDate,
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
