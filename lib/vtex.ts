const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!

const headers = {
  'X-VTEX-API-AppKey': APP_KEY,
  'X-VTEX-API-AppToken': APP_TOKEN,
  'Content-Type': 'application/json',
}

export interface VtexCustomer {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string
  createdIn: string
  userId: string
}

export interface VtexOrder {
  orderId: string
  clientProfileData: { email: string; firstName: string; lastName: string }
  value: number
  creationDate: string
  status: string
}

export interface CustomerWithOrders extends VtexCustomer {
  orders: VtexOrder[]
  totalSpent: number
  firstPurchaseDate: string | null
}

export async function fetchCustomers(
  dateFrom: string,
  dateTo: string,
  page = 1,
  pageSize = 100
): Promise<{ customers: VtexCustomer[]; total: number }> {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/dataentities/CL/search?_fields=id,email,firstName,lastName,phone,createdIn,userId&_where=createdIn%20between%20${dateFrom}T00%3A00%3A00.000Z%20AND%20${dateTo}T23%3A59%3A59.999Z&_sort=createdIn%20DESC`

  const res = await fetch(url, {
    headers: {
      ...headers,
      'REST-Range': `resources=${from}-${to}`,
    },
    next: { revalidate: 300 },
  })

  if (!res.ok) throw new Error(`VTEX MasterData error: ${res.status}`)

  const contentRange = res.headers.get('REST-Content-Range') ?? ''
  const total = parseInt(contentRange.split('/')[1] ?? '0', 10)
  const customers: VtexCustomer[] = await res.json()

  return { customers, total }
}

export async function fetchAllCustomers(
  dateFrom: string,
  dateTo: string
): Promise<VtexCustomer[]> {
  const pageSize = 100
  const first = await fetchCustomers(dateFrom, dateTo, 1, pageSize)
  const pages = Math.ceil(first.total / pageSize)

  if (pages <= 1) return first.customers

  const remaining = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      fetchCustomers(dateFrom, dateTo, i + 2, pageSize).then((r) => r.customers)
    )
  )

  return [...first.customers, ...remaining.flat()]
}

export async function fetchOrdersInPeriod(
  dateFrom: string,
  dateTo: string,
  page = 1
): Promise<{ orders: VtexOrder[]; total: number }> {
  // VTEX Orders API: correct date range format
  const from = encodeURIComponent(`${dateFrom}T00:00:00.000Z`)
  const to = encodeURIComponent(`${dateTo}T23:59:59.999Z`)
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?f_creationDate=creationDate%3A[${from}+TO+${to}]&page=${page}&per_page=100`

  const res = await fetch(url, { headers, next: { revalidate: 300 } })
  if (!res.ok) {
    console.error('Orders API error:', res.status, await res.text())
    return { orders: [], total: 0 }
  }

  const data = await res.json()
  return {
    orders: (data.list ?? []) as VtexOrder[],
    total: data.paging?.total ?? 0,
  }
}

export async function fetchAllOrdersInPeriod(
  dateFrom: string,
  dateTo: string
): Promise<VtexOrder[]> {
  const first = await fetchOrdersInPeriod(dateFrom, dateTo, 1)
  const pages = Math.ceil(first.total / 100)

  if (pages <= 1) return first.orders

  const remaining = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      fetchOrdersInPeriod(dateFrom, dateTo, i + 2).then((r) => r.orders)
    )
  )

  return [...first.orders, ...remaining.flat()]
}
