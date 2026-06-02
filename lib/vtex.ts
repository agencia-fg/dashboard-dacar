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

// Busca pedidos de um email específico (search por q=email)
export async function fetchOrdersByEmail(email: string): Promise<VtexOrder[]> {
  const url = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?q=${encodeURIComponent(email)}&per_page=100&page=1`
  const res = await fetch(url, { headers, next: { revalidate: 300 } })
  if (!res.ok) return []
  const data = await res.json()
  return (data.list ?? []) as VtexOrder[]
}

// Busca pedidos para uma lista de clientes em lotes paralelos
export async function fetchOrdersForCustomers(
  customers: VtexCustomer[],
  batchSize = 10
): Promise<Map<string, VtexOrder[]>> {
  const result = new Map<string, VtexOrder[]>()

  for (let i = 0; i < customers.length; i += batchSize) {
    const batch = customers.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async (c) => {
        if (!c.email) return { email: '', orders: [] }
        const orders = await fetchOrdersByEmail(c.email)
        return { email: c.email.toLowerCase(), orders }
      })
    )
    for (const { email, orders } of results) {
      if (email) result.set(email, orders)
    }
  }

  return result
}
