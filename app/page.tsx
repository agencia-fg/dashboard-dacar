'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { format, subDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, FunnelChart, Funnel, LabelList, PieChart, Pie, Cell,
} from 'recharts'
import { Users, ShoppingCart, TrendingUp, DollarSign, RefreshCw, Search, Repeat2, UserCheck, Download, SlidersHorizontal, MessageCircle, Mail } from 'lucide-react'
import * as XLSX from 'xlsx'

// ── Types ──────────────────────────────────────────────────────────
interface Summary {
  totalCustomers: number
  approvedCount: number
  purchasedCount: number
  neverPurchasedCount: number
  conversionRate: number
  totalRevenue: number
  paidRevenue?: number
}
interface DayData { date: string; registrations: number; purchases: number }
interface Customer {
  id: string; firstName: string; lastName: string; email: string; phone: string
  createdIn: string; purchased: boolean; orderCount: number; totalSpent: number
  paidSpent?: number
  firstPurchaseDate: string | null
  funnelStage?: string
  approved?: boolean | null
  cnpj?: string | null
  corporateName?: string | null
  tradeName?: string | null
  businessType?: string | null
}
interface DashboardData { summary: Summary; byDay: DayData[]; customers: Customer[] }

interface FunnelStep {
  step: string; label: string; count: number; description: string; color: string; pct?: number
}
interface FunnelData {
  funnel: FunnelStep[]; paidRevenue: number; totalOrders: number
  conversionRate: number; statusBreakdown: Record<string, number>
}

interface VendasSummary {
  totalOrders: number; totalRevenueCaptada: number; totalRevenuePaga: number; uniqueCustomers: number
  recurringCount: number; newCount: number; paidCustomersCount: number
  recurringRevenue: number; recurringPaidRevenue: number; newRevenue: number; newPaidRevenue: number
  avgDaysToPurchase: number | null
  isSample: boolean; sampleSize: number
  totalPaidVolumeL: number; recurringPaidVolumeL: number; newPaidVolumeL: number
}
interface VendasCustomer {
  email: string; name: string; phone: string; ordersInPeriod: number; paidOrdersInPeriod: number; totalSpent: number; paidSpent: number
  businessType?: string | null
  firstOrderDate: string; lastOrderDate: string; totalAllTime: number; isRecurring: boolean; ordersBeforePeriod: number
  registeredAt: string | null; daysToPurchase: number | null; avgDaysBetweenOrders: number | null
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null
  cnpj: string | null; corporateName: string | null; tradeName: string | null
  city: string | null; state: string | null; approved: boolean | null
  paidVolumeL: number
  paymentMethods?: string[]
}
interface RegionData { state: string; count: number; newCount: number; recurringCount: number; revenue: number; paidRevenue: number; orders: number; paidOrders: number; paidVolumeL: number; avgTicket: number; avgPaidTicket: number }
interface PaymentRow { method: string; orders: number; paidOrders: number; captada: number; paga: number }
interface VendasData { summary: VendasSummary; customers: VendasCustomer[]; regionData: RegionData[]; byPayment?: PaymentRow[] }

interface SKURow { name: string; orders: number; unitsSold: number; revenue: number; volumeL: number }
interface ProductsData { skus: SKURow[]; totalRevenue: number; totalVolumeL: number; totalOrders: number; dateFrom: string; dateTo: string }


// ── Column definitions ─────────────────────────────────────────────
interface ColDef { key: string; label: string; sortKey: keyof VendasCustomer | null }
const VENDAS_COLUMNS: ColDef[] = [
  { key: 'name',                label: 'Nome',          sortKey: 'name' },
  { key: 'email',               label: 'E-mail',        sortKey: null },
  { key: 'phone',               label: 'Telefone',      sortKey: null },
  { key: 'cnpj',                label: 'CNPJ',          sortKey: null },
  { key: 'businessType',        label: 'Tipo',          sortKey: null },
  { key: 'tradeName',           label: 'Nome Fantasia', sortKey: 'tradeName' },
  { key: 'state',               label: 'Estado',        sortKey: 'state' },
  { key: 'city',                label: 'Cidade',        sortKey: 'city' },
  { key: 'isRecurring',         label: 'Recorrência',   sortKey: 'isRecurring' },
  { key: 'registeredAt',        label: 'Cadastro',      sortKey: 'registeredAt' },
  { key: 'firstOrderDate',      label: '1ª Compra',     sortKey: 'firstOrderDate' },
  { key: 'lastOrderDate',       label: 'Última Compra', sortKey: 'lastOrderDate' },
  { key: 'daysToPurchase',      label: '→Compra',       sortKey: 'daysToPurchase' },
  { key: 'ordersInPeriod',      label: 'Ped. Captados', sortKey: 'ordersInPeriod' },
  { key: 'paidOrdersInPeriod',  label: 'Ped. Pagos',    sortKey: 'paidOrdersInPeriod' },
  { key: 'totalAllTime',        label: 'Hist.',         sortKey: 'totalAllTime' },
  { key: 'avgDaysBetweenOrders',label: 'Freq. média',   sortKey: 'avgDaysBetweenOrders' },
  { key: 'totalSpent',          label: 'Captado',       sortKey: 'totalSpent' },
  { key: 'paidSpent',           label: 'Pago',          sortKey: 'paidSpent' },
  { key: 'paidVolumeL',         label: 'Volume Faturado (L)', sortKey: 'paidVolumeL' },
  { key: 'paymentMethods',      label: 'Pagamento',     sortKey: null },
  { key: 'utmSource',           label: 'UTM Source',    sortKey: null },
  { key: 'utmMedium',           label: 'UTM Medium',    sortKey: null },
  { key: 'utmCampaign',         label: 'UTM Campaign',  sortKey: null },
]
const ALL_COL_KEYS = new Set(VENDAS_COLUMNS.map(c => c.key))

// ── Helpers ────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
const fmtDate = (iso: string) => format(new Date(iso), 'dd/MM/yyyy', { locale: ptBR })

function BizBadge({ type }: { type?: string | null }) {
  if (!type) return <span className="text-gray-600 text-xs">—</span>
  const t = type.toUpperCase()
  const cls = t.includes('CONSTRU')
    ? 'bg-orange-900/50 text-orange-300'
    : t.includes('VAREJO')
      ? 'bg-sky-900/50 text-sky-300'
      : 'bg-gray-800 text-gray-400'
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{type}</span>
}

// Frases de WhatsApp/e-mail por etapa do funil. {nome} e {empresa} são variáveis.
const CRM_STAGES: { key: string; label: string }[] = [
  { key: 'Só cadastrou',        label: 'Só cadastrou' },
  { key: 'Acessou',             label: 'Acessou (voltou ao site)' },
  { key: 'Iniciou pedido',      label: 'Iniciou pedido' },
  { key: 'Chegou ao pagamento', label: 'Chegou ao pagamento' },
  { key: 'default',             label: 'Genérica (não comprou / outros)' },
]
const DEFAULT_CRM_MESSAGES: Record<string, string> = {
  'Só cadastrou':        'Olá {nome}, tudo bem? Aqui é da Dacar Tintas. Vi que você se cadastrou com a gente, mas ainda não fez seu primeiro pedido. Posso te ajudar com alguma dúvida ou indicar o produto ideal para sua necessidade?',
  'Acessou':             'Olá {nome}, tudo bem? Aqui é da Dacar Tintas. Notei que você voltou a visitar nossa loja, mas ainda não finalizou um pedido. Posso te ajudar a encontrar o produto certo ou tirar alguma dúvida?',
  'Iniciou pedido':      'Olá {nome}, tudo bem? Aqui é da Dacar Tintas. Vi que você começou um pedido com a gente, mas não chegou a concluir. Posso te ajudar a finalizar ou esclarecer alguma dúvida sobre os produtos?',
  'Chegou ao pagamento': 'Olá {nome}, tudo bem? Aqui é da Dacar Tintas. Seu pedido ficou quase pronto — faltou apenas concluir o pagamento. Posso te ajudar a finalizar ou ver a melhor condição de pagamento para você?',
  'default':             'Olá {nome}, tudo bem? Aqui é da Dacar Tintas. Estamos à disposição para te ajudar no que precisar — dúvidas, orçamento ou indicação de produtos. Como podemos te ajudar hoje?',
}

// Normaliza telefone para formato wa.me (dígitos com DDI 55)
function waDigits(phone?: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('55') && d.length >= 12) return d
  if (d.length === 10 || d.length === 11) return '55' + d
  return d.startsWith('55') ? d : '55' + d
}

// Substitui {nome} e {empresa} no template da mensagem
function fillTemplate(tpl: string, nome?: string | null, empresa?: string | null): string {
  const primeiroNome = (nome ?? '').trim().split(' ')[0] || 'tudo bem'
  return tpl.replace(/\{nome\}/gi, primeiroNome).replace(/\{empresa\}/gi, (empresa ?? '').trim() || primeiroNome)
}

function fmtPhone(phone: string): string {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  const local = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  if (local.length === 11) return `(${local.slice(0,2)}) ${local.slice(2,7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`
  return phone
}

// ── Main Component ─────────────────────────────────────────────────
function exportToExcel(customers: VendasCustomer[], filename = 'dacar-clientes') {
  const rows = customers.map(c => ({
    'Nome': c.name,
    'E-mail': c.email,
    'Telefone': fmtPhone(c.phone),
    'CNPJ': c.cnpj ?? '',
    'Tipo': c.businessType ?? '',
    'Razão Social': c.corporateName ?? '',
    'Nome Fantasia': c.tradeName ?? '',
    'Cidade': c.city ?? '',
    'Estado': c.state ?? '',
    'Recorrência': c.isRecurring ? 'Recorrente' : 'Novo',
    'Cadastro': c.registeredAt ? fmtDate(c.registeredAt) : '',
    '1ª Compra': c.firstOrderDate ? fmtDate(c.firstOrderDate) : '',
    'Última Compra': c.lastOrderDate ? fmtDate(c.lastOrderDate) : '',
    'Dias Cad.→Compra': c.daysToPurchase ?? '',
    'Freq. Média (dias)': c.avgDaysBetweenOrders ?? '',
    'Ped. Captados': c.ordersInPeriod,
    'Ped. Pagos': c.paidOrdersInPeriod,
    'Total Histórico': c.totalAllTime,
    'Captado (R$)': c.totalSpent,
    'Pago (R$)': c.paidSpent,
    'Volume Faturado (L)': (c.paidVolumeL ?? 0) > 0 ? c.paidVolumeL : '',
    'Meios de Pagamento': c.paymentMethods?.join(', ') ?? '',
    'UTM Source': c.utmSource ?? '',
    'UTM Medium': c.utmMedium ?? '',
    'UTM Campaign': c.utmCampaign ?? '',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export default function Dashboard() {
  const [tab, setTab] = useState<'cadastros' | 'vendas' | 'regioes' | 'evolucao' | 'produtos' | 'churn'>('cadastros')
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))

  // Cadastros tab
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [showCrmPanel, setShowCrmPanel] = useState(false)
  const [crmMessages, setCrmMessages] = useState<Record<string, string>>(DEFAULT_CRM_MESSAGES)
  const msgForStage = (stage: string) => crmMessages[stage] ?? crmMessages['default']

  // Vendas tab
  const [vendas, setVendas] = useState<VendasData | null>(null)
  const [vendasLoading, setVendasLoading] = useState(false)
  const [vendasError, setVendasError] = useState('')

  // Funil VTEX
  const [funnelData, setFunnelData] = useState<FunnelData | null>(null)
  const [funnelLoading, setFunnelLoading] = useState(false)

  // Funil GA4
  interface GA4FunnelStep { step: string; value: number; pct: number }
  interface GA4Data {
    sessions: number; users: number; addToCarts: number
    checkouts: number; purchases: number; revenue: number
    startDate: string; endDate: string
    funnel: GA4FunnelStep[]
  }
  const [ga4Data, setGa4Data] = useState<GA4Data | null>(null)
  const [ga4Loading, setGa4Loading] = useState(false)
  const [ga4Error, setGa4Error] = useState('')

  // Churn — fixed 6-month window, independent of the date picker
  const [vendasChurn, setVendasChurn] = useState<VendasData | null>(null)
  const [vendasChurnLoading, setVendasChurnLoading] = useState(false)
  const [vendasChurnError, setVendasChurnError] = useState('')
  const [churnSortKey, setChurnSortKey] = useState<'dias' | 'receita'>('dias')
  const [churnSortDir, setChurnSortDir] = useState<'asc' | 'desc'>('desc')
  const toggleChurnSort = (k: 'dias' | 'receita') => {
    if (churnSortKey === k) setChurnSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setChurnSortKey(k); setChurnSortDir('desc') }
  }
  const CHURN_MONTHS = 6
  const churnDateTo   = new Date().toISOString().slice(0, 10)
  const churnDateFrom = (() => { const d = new Date(); d.setMonth(d.getMonth() - CHURN_MONTHS); return d.toISOString().slice(0, 10) })()


  // Produtos
  const [products, setProducts] = useState<ProductsData | null>(null)
  const [productsLoading, setProductsLoading] = useState(false)
  const [productsError, setProductsError] = useState('')
  const [productSearch, setProductSearch] = useState('')

  // Evolução anual
  interface MonthRow {
    month: number; label: string
    curRevenue: number; prevRevenue: number
    curNew: number; prevNew: number
    curRecurring: number; prevRecurring: number
    curVolumeL: number; prevVolumeL: number
  }
  interface EvolucaoData { curYear: number; prevYear: number; months: MonthRow[] }
  const [evolucao, setEvolucao] = useState<EvolucaoData | null>(null)
  const [evolucaoLoading, setEvolucaoLoading] = useState(false)
  const [evolucaoError, setEvolucaoError] = useState('')
  const [vendasSearch, setVendasSearch] = useState('')
  const [vendasFilter, setVendasFilter] = useState<'all' | 'recurring' | 'new'>('all')
  const [vendasStateFilter, setVendasStateFilter] = useState('')
  const [sortKey, setSortKey] = useState<keyof VendasCustomer>('totalSpent')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Column visibility
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(ALL_COL_KEYS))
  const [showColPicker, setShowColPicker] = useState(false)
  const colPickerRef = useRef<HTMLDivElement>(null)

  // Close col picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false)
      }
    }
    if (showColPicker) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColPicker])

  const toggleCol = (key: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) { if (next.size > 1) next.delete(key) }
      else next.add(key)
      return next
    })
  }

  const loadCadastros = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [dashRes, funnelRes] = await Promise.all([
        fetch(`/api/dashboard?from=${dateFrom}&to=${dateTo}`),
        fetch(`/api/funnel?from=${dateFrom}&to=${dateTo}`),
      ])
      if (!dashRes.ok) throw new Error(`Erro ${dashRes.status}`)
      const json = await dashRes.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      if (funnelRes.ok) {
        const fj = await funnelRes.json()
        if (!fj.error) setFunnelData(fj)
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Erro') }
    finally { setLoading(false) }
  }, [dateFrom, dateTo])

  const loadGA4 = useCallback(async () => {
    setGa4Loading(true); setGa4Error('')
    try {
      const res = await fetch(`/api/ga?startDate=${dateFrom}&endDate=${dateTo}`)
      const json = await res.json()
      if (json.error) { setGa4Error(json.error); return }
      setGa4Data(json)
    } catch (e: unknown) { setGa4Error(e instanceof Error ? e.message : 'Erro') }
    finally { setGa4Loading(false) }
  }, [dateFrom, dateTo])

  const loadVendas = useCallback(async () => {
    setVendasLoading(true); setVendasError('')
    try {
      const res = await fetch(`/api/vendas?from=${dateFrom}&to=${dateTo}`)
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setVendas(json)
    } catch (e: unknown) { setVendasError(e instanceof Error ? e.message : 'Erro') }
    finally { setVendasLoading(false) }
  }, [dateFrom, dateTo])

  useEffect(() => { loadCadastros(); loadGA4() }, [loadCadastros, loadGA4])

  const loadVendasChurn = useCallback(async () => {
    setVendasChurnLoading(true); setVendasChurnError('')
    try {
      const res = await fetch(`/api/vendas?from=${churnDateFrom}&to=${churnDateTo}`)
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setVendasChurn(json)
    } catch (e: unknown) { setVendasChurnError(e instanceof Error ? e.message : 'Erro') }
    finally { setVendasChurnLoading(false) }
  }, [churnDateFrom, churnDateTo])

  const loadProducts = useCallback(async () => {
    setProductsLoading(true); setProductsError('')
    try {
      const res = await fetch(`/api/products?from=${dateFrom}&to=${dateTo}`)
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setProducts(json)
    } catch (e: unknown) { setProductsError(e instanceof Error ? e.message : 'Erro') }
    finally { setProductsLoading(false) }
  }, [dateFrom, dateTo])

  const loadEvolucao = useCallback(async () => {
    setEvolucaoLoading(true); setEvolucaoError('')
    try {
      const res = await fetch('/api/yearly')
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setEvolucao(json)
    } catch (e: unknown) { setEvolucaoError(e instanceof Error ? e.message : 'Erro') }
    finally { setEvolucaoLoading(false) }
  }, [])

  const handleTabChange = (t: 'cadastros' | 'vendas' | 'regioes' | 'evolucao' | 'produtos' | 'churn') => {
    setTab(t)
    if ((t === 'vendas' || t === 'regioes') && !vendas) loadVendas()
    if (t === 'churn' && !vendasChurn) loadVendasChurn()
    if (t === 'evolucao' && !evolucao) loadEvolucao()
    if (t === 'produtos' && !products) loadProducts()
  }

  const handleUpdate = () => {
    if (tab === 'cadastros') { loadCadastros(); loadGA4() }
    else if (tab === 'produtos') { setProducts(null); loadProducts() }
    else if (tab === 'churn') { setVendasChurn(null); loadVendasChurn() }
    else { setVendas(null); loadVendas() }
    // churn reuses vendas data, cleared above
  }

  const filteredCustomers = (data?.customers ?? []).filter((c) => {
    const q = search.toLowerCase()
    const matchSearch = search === '' || c.email?.toLowerCase().includes(q) ||
      c.firstName?.toLowerCase().includes(q) || c.lastName?.toLowerCase().includes(q) ||
      (c.cnpj ?? '').toLowerCase().includes(q) ||
      (c.corporateName ?? '').toLowerCase().includes(q) || (c.tradeName ?? '').toLowerCase().includes(q)
    const stage = c.funnelStage ?? (c.purchased ? 'Comprou' : 'Só cadastrou')
    const matchStatus = filterStatus === 'all'
      || (filterStatus === 'purchased' && c.purchased)
      || (filterStatus === 'not_purchased' && !c.purchased)
      || (filterStatus === 'reprovado' && c.approved !== true)
      || filterStatus === stage
    return matchSearch && matchStatus
  })

  // Unique states for filter dropdown
  const uniqueStates = useMemo(() => {
    if (!vendas) return []
    const states = [...new Set(vendas.customers.map(c => c.state).filter(Boolean) as string[])]
    return states.sort()
  }, [vendas])

  const filteredVendas = useMemo(() => {
    const q = vendasSearch.toLowerCase().trim()
    const filtered = (vendas?.customers ?? []).filter((c) => {
      const qDigits = q.replace(/\D/g, '')
      const matchSearch = q === '' ||
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        (qDigits.length > 0 && (c.phone ?? '').replace(/\D/g, '').includes(qDigits)) ||
        (qDigits.length > 0 && (c.cnpj ?? '').replace(/\D/g, '').includes(qDigits)) ||
        (c.tradeName ?? '').toLowerCase().includes(q) ||
        (c.corporateName ?? '').toLowerCase().includes(q)
      const matchFilter = vendasFilter === 'all' || (vendasFilter === 'recurring' && c.isRecurring) || (vendasFilter === 'new' && !c.isRecurring)
      const matchState = vendasStateFilter === '' || c.state === vendasStateFilter
      return matchSearch && matchFilter && matchState
    })
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [vendas, vendasSearch, vendasFilter, vendasStateFilter, sortKey, sortDir])

  const handleSort = (key: keyof VendasCustomer) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const SortIcon = ({ k }: { k: keyof VendasCustomer }) => (
    <span className="ml-1 opacity-50">{sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
  )

  const miniPieData = data
    ? [
        { name: 'Cadastros', value: data.summary.totalCustomers, fill: '#3b82f6' },
        { name: 'Compraram', value: data.summary.purchasedCount, fill: '#10b981' },
      ]
    : []

  const pieData = vendas
    ? [
        { name: 'Recorrentes', value: vendas.summary.recurringCount, color: '#8b5cf6' },
        { name: 'Novos', value: vendas.summary.newCount, color: '#3b82f6' },
      ]
    : []

  const isLoading = tab === 'cadastros' ? loading : tab === 'evolucao' ? evolucaoLoading : tab === 'produtos' ? productsLoading : tab === 'churn' ? vendasChurnLoading : vendasLoading

  // Churn risk — fixed thresholds: ≤30d green, 31-60d yellow, >60d red
  // Only recurring customers (totalAllTime >= 2) appear in the semaphore
  const TODAY_MS = new Date().setHours(0, 0, 0, 0)
  const churnList = useMemo(() => {
    if (!vendasChurn) return []
    return vendasChurn.customers
      .filter(c => c.lastOrderDate && c.totalAllTime >= 2)
      .map(c => {
        const lastMs = new Date(c.lastOrderDate).setHours(0, 0, 0, 0)
        const diasDesde = Math.floor((TODAY_MS - lastMs) / 86400000)
        const risk: 'green' | 'yellow' | 'red' = diasDesde <= 30 ? 'green' : diasDesde <= 60 ? 'yellow' : 'red'
        return { ...c, diasDesde, risk }
      })
      .sort((a, b) => b.diasDesde - a.diasDesde)
  }, [vendasChurn, TODAY_MS])

  // Single-purchase customers — shown separately at the bottom
  const singlePurchaseList = useMemo(() => {
    if (!vendasChurn) return []
    return vendasChurn.customers
      .filter(c => c.lastOrderDate && c.totalAllTime < 2)
      .map(c => {
        const lastMs = new Date(c.lastOrderDate).setHours(0, 0, 0, 0)
        const diasDesde = Math.floor((TODAY_MS - lastMs) / 86400000)
        return { ...c, diasDesde }
      })
      .sort((a, b) => b.diasDesde - a.diasDesde)
  }, [vendasChurn, TODAY_MS])

  // Render a single cell value for a given column key + customer
  function renderCell(col: ColDef, c: VendasCustomer) {
    switch (col.key) {
      case 'name':        return <td key={col.key} className="py-2 pr-3 text-gray-200">{c.name}</td>
      case 'email':       return <td key={col.key} className="py-2 pr-3 text-gray-400 max-w-[180px] truncate">{c.email}</td>
      case 'phone':       return <td key={col.key} className="py-2 pr-3 text-gray-400">{fmtPhone(c.phone)}</td>
      case 'cnpj':        return <td key={col.key} className="py-2 pr-3 text-gray-400">{c.cnpj || '—'}</td>
      case 'businessType': return <td key={col.key} className="py-2 pr-3"><BizBadge type={c.businessType} /></td>
      case 'tradeName':   return <td key={col.key} className="py-2 pr-3 text-gray-300">{c.tradeName || c.corporateName || '—'}</td>
      case 'state':       return <td key={col.key} className="py-2 pr-3 text-gray-400">{c.state || '—'}</td>
      case 'city':        return <td key={col.key} className="py-2 pr-3 text-gray-400">{c.city || '—'}</td>
      case 'isRecurring': return (
        <td key={col.key} className="py-2 pr-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.isRecurring ? 'bg-purple-900/60 text-purple-400' : 'bg-blue-900/60 text-blue-400'}`}>
            {c.isRecurring ? 'Recorrente' : 'Novo'}
          </span>
        </td>
      )
      case 'registeredAt':   return <td key={col.key} className="py-2 pr-3 text-gray-400">{c.registeredAt ? fmtDate(c.registeredAt) : '—'}</td>
      case 'firstOrderDate': return <td key={col.key} className="py-2 pr-3 text-gray-400">{c.firstOrderDate ? fmtDate(c.firstOrderDate) : '—'}</td>
      case 'lastOrderDate':  return <td key={col.key} className="py-2 pr-3 text-gray-400">{c.lastOrderDate ? fmtDate(c.lastOrderDate) : '—'}</td>
      case 'daysToPurchase': return (
        <td key={col.key} className="py-2 pr-3 text-center">
          {c.daysToPurchase !== null
            ? <span className={`font-medium ${c.daysToPurchase === 0 ? 'text-green-400' : c.daysToPurchase <= 7 ? 'text-yellow-400' : 'text-orange-400'}`}>
                {c.daysToPurchase === 0 ? 'Mesmo dia' : `${c.daysToPurchase}d`}
              </span>
            : <span className="text-gray-600">—</span>}
        </td>
      )
      case 'ordersInPeriod':       return <td key={col.key} className="py-2 pr-3 text-center text-gray-300">{c.ordersInPeriod}</td>
      case 'paidOrdersInPeriod':   return (
        <td key={col.key} className="py-2 pr-3 text-center">
          {c.paidOrdersInPeriod > 0
            ? <span className="text-green-400 font-medium">{c.paidOrdersInPeriod}</span>
            : <span className="text-gray-600">0</span>}
          {c.ordersInPeriod > c.paidOrdersInPeriod && (
            <span className="text-gray-600 text-xs ml-1">/ {c.ordersInPeriod}</span>
          )}
        </td>
      )
      case 'totalAllTime':         return (
        <td key={col.key} className="py-2 pr-3 text-center">
          <span className={c.totalAllTime > 1 ? 'text-purple-400 font-semibold' : 'text-gray-400'}>{c.totalAllTime}</span>
        </td>
      )
      case 'avgDaysBetweenOrders': return (
        <td key={col.key} className="py-2 pr-3 text-center">
          {c.avgDaysBetweenOrders !== null
            ? <span className={`font-medium ${c.avgDaysBetweenOrders <= 30 ? 'text-green-400' : c.avgDaysBetweenOrders <= 90 ? 'text-yellow-400' : 'text-gray-400'}`}>
                a cada {c.avgDaysBetweenOrders}d
              </span>
            : <span className="text-gray-600">—</span>}
        </td>
      )
      case 'totalSpent': return <td key={col.key} className="py-2 pr-3 text-gray-300">{fmt(c.totalSpent)}</td>
      case 'paidSpent':  return <td key={col.key} className="py-2 pr-3 text-gray-300">{c.paidSpent > 0 ? fmt(c.paidSpent) : '—'}</td>
      case 'paidVolumeL': return (
        <td key={col.key} className="py-2 pr-3 text-center">
          {(c.paidVolumeL ?? 0) > 0
            ? <span className="font-medium text-cyan-400">{c.paidVolumeL.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} L</span>
            : <span className="text-gray-600">—</span>}
        </td>
      )
      case 'paymentMethods': return (
        <td key={col.key} className="py-2 pr-3">
          {(c.paymentMethods?.length ?? 0) > 0
            ? <div className="flex flex-wrap gap-1">{c.paymentMethods!.map(m => (
                <span key={m} className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300 whitespace-nowrap">{m}</span>
              ))}</div>
            : <span className="text-gray-600">—</span>}
        </td>
      )
      case 'utmSource':  return <td key={col.key} className="py-2 pr-3 text-gray-400">{c.utmSource || '—'}</td>
      case 'utmMedium':  return <td key={col.key} className="py-2 pr-3 text-gray-400">{c.utmMedium || '—'}</td>
      case 'utmCampaign':return <td key={col.key} className="py-2 text-gray-400">{c.utmCampaign || '—'}</td>
      default:           return <td key={col.key} className="py-2 pr-3 text-gray-400">—</td>
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Dacar Tintas — Dashboard</h1>
          <div className="flex gap-1 mt-2">
            {([['cadastros','Cadastros vs. Compras'],['vendas','Vendas & Recorrência'],['regioes','Regiões'],['evolucao','Evolução Anual'],['produtos','Ranking de Produtos'],['churn','Risco de Churn']] as const).map(([t, label]) => (
              <button key={t} onClick={() => handleTabChange(t)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200" />
          <span className="text-gray-500">até</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200" />
          <button onClick={handleUpdate} disabled={isLoading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-1.5 rounded text-sm font-medium transition-colors">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'Carregando...' : 'Atualizar'}
          </button>
          <button onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); window.location.href = '/login' }}
            className="px-3 py-1.5 rounded text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors">
            Sair
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* ── TAB: CADASTROS ── */}
        {tab === 'cadastros' && (
          <>
            {error && <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 text-sm">{error}</div>}

            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <KpiCard icon={<Users size={20} />} label="Total de Cadastros" value={data?.summary.totalCustomers ?? '—'} color="blue" />
              <KpiCard icon={<UserCheck size={20} />} label="Cadastros Aprovados" value={data?.summary.approvedCount ?? '—'} sub={data?.summary.approvedCount != null ? `${((data.summary.approvedCount / data.summary.totalCustomers) * 100).toFixed(0)}% do total` : undefined} color="green" />
              <KpiCard icon={<ShoppingCart size={20} />} label="Compraram" value={data?.summary.purchasedCount ?? '—'} sub={data ? `${data.summary.conversionRate}% dos aprovados` : undefined} color="purple" />
              <KpiCard icon={<TrendingUp size={20} />} label="Não compraram" value={data?.summary.neverPurchasedCount ?? '—'} sub={data ? `${(100 - data.summary.conversionRate).toFixed(1)}% dos aprovados` : undefined} color="red" />
              <KpiCard icon={<DollarSign size={20} />} label="Receita Captada" value={data ? fmt(data.summary.totalRevenue) : '—'} sub="todos os pedidos" color="yellow" />
              <KpiCard icon={<DollarSign size={20} />} label="Receita Paga" value={data?.summary.paidRevenue != null ? fmt(data.summary.paidRevenue) : '—'} sub="pagamento confirmado" color="green" />
            </div>

            {/* Funil — onde os não-compradores travaram */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-gray-300 mb-1">Onde os novos clientes pararam</h2>
              {data ? (() => {
                const aprovados = data.customers.filter(c => c.approved === true)
                const naoCompraram = aprovados.filter(c => !c.purchased)
                const total = naoCompraram.length

                const etapas = [
                  { label: 'Chegou ao pagamento', stage: 'Chegou ao pagamento', color: '#f97316', desc: 'Criou pedido mas não pagou' },
                  { label: 'Iniciou pedido',       stage: 'Iniciou pedido',       color: '#f59e0b', desc: 'Iniciou mas cancelou antes do pagamento' },
                  { label: 'Voltou ao site',        stage: 'Acessou',              color: '#6366f1', desc: 'Retornou após o cadastro, sem pedido' },
                  { label: 'Só se cadastrou',       stage: 'Só cadastrou',         color: '#6b7280', desc: 'Não voltou após o cadastro' },
                ]

                const counts = etapas.map(e => ({
                  ...e,
                  count: naoCompraram.filter(c => (c.funnelStage ?? 'Só cadastrou') === e.stage).length,
                }))

                const maxCount = Math.max(...counts.map(c => c.count), 1)
                const compraramAprovados = aprovados.filter(c => c.purchased).length
                const reprovados = data.customers.length - aprovados.length

                return (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-gray-500 mb-3">
                      Considerando apenas os {aprovados.length} cadastros aprovados — {compraramAprovados} compraram, {total} não. {reprovados > 0 && <span className="text-red-400/70">{reprovados} reprovados na triagem ficam fora do funil.</span>}
                    </p>
                    {counts.map(e => {
                      const barWidth = (e.count / maxCount) * 100
                      const pct = total > 0 ? (e.count / total * 100).toFixed(1) : '0'
                      return (
                        <div key={e.stage} className="flex items-center gap-3">
                          <div className="w-40 text-right">
                            <div className="text-xs text-gray-300 leading-tight">{e.label}</div>
                            <div className="text-xs text-gray-600 leading-tight">{e.desc}</div>
                          </div>
                          <div className="flex-1">
                            <div className="h-10 rounded-lg flex items-center px-4 transition-all"
                              style={{ width: `${Math.max(barWidth, 3)}%`, backgroundColor: e.color + '30', border: `1px solid ${e.color}60` }}>
                              <span className="text-white font-bold text-sm">{e.count.toLocaleString('pt-BR')}</span>
                            </div>
                          </div>
                          <div className="w-20 text-right">
                            <span className="text-xs font-semibold" style={{ color: e.color }}>{pct}%</span>
                            <div className="text-xs text-gray-600">dos {total}</div>
                          </div>
                        </div>
                      )
                    })}
                    <div className="mt-3 pt-3 border-t border-gray-800 flex flex-wrap gap-6 text-sm">
                      <div><span className="text-gray-500">Compraram: </span><span className="font-bold text-green-400">{compraramAprovados}</span><span className="text-gray-600 text-xs ml-1">({aprovados.length > 0 ? (compraramAprovados / aprovados.length * 100).toFixed(1) : 0}% dos aprovados)</span></div>
                      <div><span className="text-gray-500">Receita no período: </span><span className="font-bold text-green-400">{fmt(data.summary.totalRevenue)}</span></div>
                    </div>
                  </div>
                )
              })() : (
                <div className="text-center py-8 text-gray-500 text-sm">Carregando...</div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-gray-300 mb-4">Cadastros × Compras por dia</h2>
                {data && (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data.byDay}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(v) => format(new Date(v + 'T12:00:00'), 'dd/MM')} />
                      <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                      <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} labelFormatter={(v) => format(new Date(v + 'T12:00:00'), 'dd/MM/yyyy')} />
                      <Legend />
                      <Line type="monotone" dataKey="registrations" name="Cadastros" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="purchases" name="Compraram" stroke="#10b981" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-gray-300 mb-4">Funil de Conversão</h2>
                {data && (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <FunnelChart>
                        <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                        <Funnel dataKey="value" data={miniPieData} isAnimationActive>
                          <LabelList position="center" fill="#fff" fontSize={13} />
                        </Funnel>
                      </FunnelChart>
                    </ResponsiveContainer>
                    <div className="mt-3 space-y-2">
                      {miniPieData.map((f) => (
                        <div key={f.name} className="flex justify-between text-sm">
                          <span className="text-gray-400">{f.name}</span>
                          <span className="font-semibold" style={{ color: f.fill }}>{f.value}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm border-t border-gray-700 pt-2">
                        <span className="text-gray-400">Taxa de conversão</span>
                        <span className="font-semibold text-white">{data.summary.conversionRate}%</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-4">Cadastros sem compra vs. com compra por dia</h2>
              {data && (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.byDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(v) => format(new Date(v + 'T12:00:00'), 'dd/MM')} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} labelFormatter={(v) => format(new Date(v + 'T12:00:00'), 'dd/MM/yyyy')} />
                    <Legend />
                    <Bar dataKey="purchases" name="Compraram" fill="#10b981" stackId="a" />
                    <Bar dataKey="registrations" name="Não compraram" fill="#ef4444" stackId="a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h2 className="text-sm font-semibold text-gray-300">Lista de Clientes ({filteredCustomers.length})</h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" />
                    <input placeholder="Buscar nome, e-mail ou CNPJ" value={search} onChange={(e) => setSearch(e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-gray-200 w-64" />
                  </div>
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200">
                    <option value="all">Todos</option>
                    <option value="purchased">Compraram</option>
                    <option value="not_purchased">Não compraram</option>
                    <option value="Chegou ao pagamento">Chegou ao pagamento</option>
                    <option value="Iniciou pedido">Iniciou pedido</option>
                    <option value="Acessou">Acessou</option>
                    <option value="Só cadastrou">Só cadastrou</option>
                    <option value="reprovado">Reprovados</option>
                  </select>
                  <button onClick={() => setShowCrmPanel(v => !v)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${showCrmPanel ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                    <MessageCircle size={13} /> Mensagem
                  </button>
                  <button onClick={() => {
                    const rows = filteredCustomers.map(c => ({
                      'Nome': `${c.firstName} ${c.lastName}`.trim(),
                      'Empresa': c.tradeName || c.corporateName || '',
                      'Tipo': c.businessType ?? '',
                      'CNPJ': c.cnpj ?? '',
                      'E-mail': c.email ?? '',
                      'Telefone': c.phone ?? '',
                      'Etapa': c.funnelStage ?? (c.purchased ? 'Comprou' : 'Só cadastrou'),
                      'Aprovado': c.approved === true ? 'Sim' : 'Não',
                      'Cadastro': c.createdIn ? fmtDate(c.createdIn) : '',
                    }))
                    const ws = XLSX.utils.json_to_sheet(rows)
                    const wb = XLSX.utils.book_new()
                    XLSX.utils.book_append_sheet(wb, ws, 'Segmento')
                    XLSX.writeFile(wb, `dacar-segmento-${filterStatus}.xlsx`)
                  }} className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors">
                    <Download size={13} /> Exportar segmento
                  </button>
                </div>
              </div>

              {showCrmPanel && (
                <div className="mb-4 p-3 bg-gray-800/60 border border-gray-700/60 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-300">Mensagens por etapa (o botão escolhe a frase certa conforme o status do cliente)</label>
                    <span className="text-xs text-gray-500">Variáveis: <code className="text-blue-400">{'{nome}'}</code> <code className="text-blue-400">{'{empresa}'}</code></span>
                  </div>
                  {CRM_STAGES.map(s => (
                    <div key={s.key}>
                      <label className="text-xs text-gray-400 mb-1 block">{s.label}</label>
                      <textarea value={crmMessages[s.key] ?? ''} rows={2}
                        onChange={(e) => setCrmMessages(m => ({ ...m, [s.key]: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 resize-y" />
                    </div>
                  ))}
                  <p className="text-xs text-gray-500">💡 O botão abre o WhatsApp/e-mail com a mensagem pronta — você revisa e clica enviar. Nada é disparado automaticamente.</p>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-left text-gray-500 text-xs uppercase">
                      <th className="pb-2 pr-4">Nome</th><th className="pb-2 pr-4">Empresa</th>
                      <th className="pb-2 pr-4">Tipo</th>
                      <th className="pb-2 pr-4">CNPJ</th><th className="pb-2 pr-4">E-mail</th>
                      <th className="pb-2 pr-4">Telefone</th><th className="pb-2 pr-4">Cadastro</th>
                      <th className="pb-2 pr-4">Status</th><th className="pb-2 pr-4">Pedidos</th>
                      <th className="pb-2 pr-4">Captado</th><th className="pb-2 pr-4">Pago</th><th className="pb-2 pr-4">1ª Compra</th>
                      <th className="pb-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {filteredCustomers.slice(0, 200).map((c) => (
                      <tr key={c.id} className="hover:bg-gray-800/50 transition-colors">
                        <td className="py-2 pr-4 text-gray-200">{c.firstName} {c.lastName}</td>
                        <td className="py-2 pr-4 text-gray-300">{c.tradeName || c.corporateName || '—'}</td>
                        <td className="py-2 pr-4"><BizBadge type={c.businessType} /></td>
                        <td className="py-2 pr-4 text-gray-400">{c.cnpj || '—'}</td>
                        <td className="py-2 pr-4 text-gray-400">{c.email}</td>
                        <td className="py-2 pr-4 text-gray-400">{fmtPhone(c.phone)}</td>
                        <td className="py-2 pr-4 text-gray-400">{c.createdIn ? fmtDate(c.createdIn) : '—'}</td>
                        <td className="py-2 pr-4">
                          {(() => {
                            const stage = c.funnelStage ?? (c.purchased ? 'Comprou' : 'Só cadastrou')
                            const cfg: Record<string, {bg: string; text: string}> = {
                              'Comprou':              { bg: 'bg-green-900/60',  text: 'text-green-400' },
                              'Chegou ao pagamento':  { bg: 'bg-yellow-900/60', text: 'text-yellow-400' },
                              'Iniciou pedido':       { bg: 'bg-orange-900/60', text: 'text-orange-400' },
                              'Acessou':              { bg: 'bg-blue-900/60',   text: 'text-blue-400' },
                              'Só cadastrou':         { bg: 'bg-gray-800',      text: 'text-gray-500' },
                            }
                            const { bg, text } = cfg[stage] ?? { bg: 'bg-gray-800', text: 'text-gray-400' }
                            return (
                              <span className="inline-flex items-center gap-1">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>{stage}</span>
                                {c.approved !== true && (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/60 text-red-400">Reprovado</span>
                                )}
                              </span>
                            )
                          })()}
                        </td>
                        <td className="py-2 pr-4 text-center text-gray-300">{c.orderCount}</td>
                        <td className="py-2 pr-4 text-gray-300">{c.totalSpent > 0 ? fmt(c.totalSpent) : '—'}</td>
                        <td className="py-2 pr-4 text-green-400">{(c.paidSpent ?? 0) > 0 ? fmt(c.paidSpent!) : '—'}</td>
                        <td className="py-2 pr-4 text-gray-400">{c.firstPurchaseDate ? fmtDate(c.firstPurchaseDate) : '—'}</td>
                        <td className="py-2">
                          {(() => {
                            const empresa = c.tradeName || c.corporateName || ''
                            const stage = c.funnelStage ?? (c.purchased ? 'Comprou' : 'Só cadastrou')
                            const msg = fillTemplate(msgForStage(stage), c.firstName, empresa)
                            const wa = waDigits(c.phone)
                            return (
                              <div className="flex items-center gap-1.5">
                                {wa
                                  ? <a href={`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"
                                      title="Abrir WhatsApp com mensagem pronta"
                                      className="inline-flex items-center justify-center w-7 h-7 rounded bg-green-900/40 text-green-400 hover:bg-green-800/60 transition-colors">
                                      <MessageCircle size={14} />
                                    </a>
                                  : <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-gray-800 text-gray-700" title="Sem telefone"><MessageCircle size={14} /></span>}
                                {c.email
                                  ? <a href={`mailto:${c.email}?subject=${encodeURIComponent('Dacar Tintas')}&body=${encodeURIComponent(msg)}`}
                                      title="Abrir e-mail com mensagem pronta"
                                      className="inline-flex items-center justify-center w-7 h-7 rounded bg-blue-900/40 text-blue-400 hover:bg-blue-800/60 transition-colors">
                                      <Mail size={14} />
                                    </a>
                                  : <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-gray-800 text-gray-700" title="Sem e-mail"><Mail size={14} /></span>}
                              </div>
                            )
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredCustomers.length > 200 && (
                  <p className="text-xs text-gray-500 mt-3 text-center">Mostrando 200 de {filteredCustomers.length}. Use os filtros para refinar.</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── TAB: REGIÕES ── */}
        {tab === 'regioes' && (
          <>
            {vendasLoading && <div className="text-center py-20 text-gray-400 text-sm">Carregando dados...</div>}
            {vendas && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard icon={<Users size={20} />} label="Estados com clientes" value={vendas.regionData.length} color="blue" />
                  <KpiCard icon={<ShoppingCart size={20} />} label="Clientes c/ localização" value={vendas.regionData.filter(r => r.state !== 'Não informado').reduce((s, r) => s + r.count, 0)} color="green" />
                  <KpiCard icon={<DollarSign size={20} />} label="Receita Captada Total" value={fmt(vendas.summary.totalRevenueCaptada)} color="yellow" />
                  <KpiCard icon={<DollarSign size={20} />} label="Receita Paga Total" value={fmt(vendas.summary.totalRevenuePaga)} color="purple" />
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-300">Receita por Estado</h2>
                    <button onClick={() => {
                      const ws = XLSX.utils.json_to_sheet(vendas.regionData.map(r => ({
                        Estado: r.state, 'Total Clientes': r.count, Novos: r.newCount, Recorrentes: r.recurringCount,
                        'Ped. Captados': r.orders, 'Ped. Pagos': r.paidOrders, 'Receita Captada (R$)': r.revenue.toFixed(2),
                        'Receita Paga (R$)': r.paidRevenue.toFixed(2),
                        'Ticket Médio Captado (R$)': r.avgTicket.toFixed(2),
                        'Ticket Médio Pago (R$)': r.avgPaidTicket.toFixed(2),
                        'Volume Pago (L)': r.paidVolumeL.toFixed(1),
                        '% Pago/Captado': r.revenue > 0 ? ((r.paidRevenue / r.revenue) * 100).toFixed(1) + '%' : '—',
                      })))
                      const wb = XLSX.utils.book_new()
                      XLSX.utils.book_append_sheet(wb, ws, 'Regiões')
                      XLSX.writeFile(wb, 'dacar-regioes.xlsx')
                    }} className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors">
                      <Download size={13} /> Excel
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-left text-gray-500 text-xs uppercase">
                          <th className="pb-2 pr-4">Estado</th>
                          <th className="pb-2 pr-4">Clientes</th>
                          <th className="pb-2 pr-4">Novos</th>
                          <th className="pb-2 pr-4">Recorrentes</th>
                          <th className="pb-2 pr-4">Ped. Captados</th>
                          <th className="pb-2 pr-4">Ped. Pagos</th>
                          <th className="pb-2 pr-4">Receita Captada</th>
                          <th className="pb-2 pr-4">Receita Paga</th>
                          <th className="pb-2 pr-4">Ticket Médio (cap.)</th>
                          <th className="pb-2 pr-4">Ticket Médio (pago)</th>
                          <th className="pb-2 pr-4">Volume Pago (L)</th>
                          <th className="pb-2">% do Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {vendas.regionData.map(r => (
                          <tr key={r.state} className="hover:bg-gray-800/50">
                            <td className="py-2 pr-4 text-gray-200 font-medium">{r.state}</td>
                            <td className="py-2 pr-4 text-gray-300">{r.count}</td>
                            <td className="py-2 pr-4">
                              <span className="text-blue-400 font-medium">{r.newCount}</span>
                              <span className="text-gray-600 text-xs ml-1">({r.count > 0 ? ((r.newCount/r.count)*100).toFixed(0) : 0}%)</span>
                            </td>
                            <td className="py-2 pr-4">
                              <span className="text-purple-400 font-medium">{r.recurringCount}</span>
                              <span className="text-gray-600 text-xs ml-1">({r.count > 0 ? ((r.recurringCount/r.count)*100).toFixed(0) : 0}%)</span>
                            </td>
                            <td className="py-2 pr-4 text-gray-300">{r.orders}</td>
                            <td className="py-2 pr-4 text-green-400 font-medium">{r.paidOrders}</td>
                            <td className="py-2 pr-4 text-gray-300">{fmt(r.revenue)}</td>
                            <td className="py-2 pr-4 text-green-400 font-medium">{fmt(r.paidRevenue)}</td>
                            <td className="py-2 pr-4 text-gray-400 text-xs">{r.avgTicket > 0 ? fmt(r.avgTicket) : '—'}</td>
                            <td className="py-2 pr-4 text-yellow-400 text-xs font-medium">{r.avgPaidTicket > 0 ? fmt(r.avgPaidTicket) : '—'}</td>
                            <td className="py-2 pr-4 text-cyan-400 text-xs">{r.paidVolumeL > 0 ? `${r.paidVolumeL.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L` : '—'}</td>
                            <td className="py-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-gray-800 rounded-full h-1.5 max-w-24">
                                  <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${((r.revenue / vendas.summary.totalRevenueCaptada) * 100).toFixed(0)}%` }} />
                                </div>
                                <span className="text-xs text-gray-400">{((r.revenue / vendas.summary.totalRevenueCaptada) * 100).toFixed(1)}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </>
            )}
          </>
        )}

        {/* ── TAB: VENDAS ── */}
        {tab === 'vendas' && (
          <>
            {vendasError && <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 text-sm">{vendasError}</div>}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2.5 text-xs text-gray-400">
              💡 Esta aba mostra <strong className="text-gray-300">todos os pedidos do período</strong>, independente de quando o cliente se cadastrou. A aba &quot;Cadastros vs. Compras&quot; mostra apenas clientes que se cadastraram no período selecionado.
            </div>
            {vendasLoading && <div className="text-center py-20 text-gray-400 text-sm">Buscando pedidos e analisando recorrência... pode levar alguns segundos.</div>}

            {vendas && (
              <>
                {vendas.summary.isSample && (
                  <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 text-yellow-300 text-sm">
                    ⚠️ Análise de recorrência baseada nos primeiros {vendas.summary.sampleSize} pedidos do período. Total real: {vendas.summary.totalOrders} pedidos.
                  </div>
                )}

                {/* KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <KpiCard icon={<ShoppingCart size={20} />} label="Total de Pedidos" value={vendas.summary.totalOrders} color="blue" />
                  <KpiCard icon={<DollarSign size={20} />} label="Receita Captada" value={fmt(vendas.summary.totalRevenueCaptada)} sub="todos os pedidos" color="yellow" />
                  <KpiCard icon={<DollarSign size={20} />} label="Receita Paga" value={fmt(vendas.summary.totalRevenuePaga)} sub="pagamento confirmado" color="green" />
                  <KpiCard icon={<Repeat2 size={20} />} label="Clientes Recorrentes" value={vendas.summary.recurringCount}
                    sub={vendas.summary.uniqueCustomers > 0 ? `${((vendas.summary.recurringCount / vendas.summary.uniqueCustomers) * 100).toFixed(1)}% dos compradores` : undefined} color="purple" />
                  <KpiCard icon={<UserCheck size={20} />} label="Clientes Novos" value={vendas.summary.newCount}
                    sub={vendas.summary.uniqueCustomers > 0 ? `${((vendas.summary.newCount / vendas.summary.uniqueCustomers) * 100).toFixed(1)}% dos compradores` : undefined} color="blue" />
                  <KpiCard icon={<ShoppingCart size={20} />} label="Clientes que Pagaram" value={vendas.summary.paidCustomersCount}
                    sub={vendas.summary.uniqueCustomers > 0 ? `${((vendas.summary.paidCustomersCount / vendas.summary.uniqueCustomers) * 100).toFixed(1)}% dos compradores` : undefined} color="green" />
                  <KpiCard icon={<TrendingUp size={20} />} label="Média: cadastro → compra"
                    value={vendas.summary.avgDaysToPurchase !== null ? `${vendas.summary.avgDaysToPurchase} dias` : '—'}
                    sub="apenas clientes novos" color="red" />
                  {vendas.summary.totalPaidVolumeL > 0 && (
                    <KpiCard icon={<ShoppingCart size={20} />} label="Volume Faturado Total"
                      value={`${vendas.summary.totalPaidVolumeL.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`}
                      sub="apenas pedidos pagos" color="blue" />
                  )}
                  {vendas.summary.recurringPaidVolumeL > 0 && (
                    <KpiCard icon={<Repeat2 size={20} />} label="Volume Recorrentes"
                      value={`${vendas.summary.recurringPaidVolumeL.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`}
                      sub={vendas.summary.totalPaidVolumeL > 0 ? `${((vendas.summary.recurringPaidVolumeL / vendas.summary.totalPaidVolumeL) * 100).toFixed(1)}% do total` : undefined}
                      color="purple" />
                  )}
                  {vendas.summary.newPaidVolumeL > 0 && (
                    <KpiCard icon={<UserCheck size={20} />} label="Volume Novos"
                      value={`${vendas.summary.newPaidVolumeL.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`}
                      sub={vendas.summary.totalPaidVolumeL > 0 ? `${((vendas.summary.newPaidVolumeL / vendas.summary.totalPaidVolumeL) * 100).toFixed(1)}% do total` : undefined}
                      color="green" />
                  )}
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Pie recorrência */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-gray-300 mb-4">Novos vs. Recorrentes</h2>
                    <div className="flex items-center gap-4">
                      <div className="relative" style={{ width: 160, height: 160, flexShrink: 0 }}>
                        <ResponsiveContainer width={160} height={160}>
                          <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" paddingAngle={3}>
                              {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                              formatter={(v) => [Number(v), '']} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-4 flex-1">
                        {[
                          { label: 'Recorrentes', count: vendas.summary.recurringCount, revenue: vendas.summary.recurringRevenue, paidRevenue: vendas.summary.recurringPaidRevenue, color: 'bg-purple-500', pct: vendas.summary.uniqueCustomers > 0 ? ((vendas.summary.recurringCount / vendas.summary.uniqueCustomers) * 100).toFixed(1) : '0' },
                          { label: 'Novos', count: vendas.summary.newCount, revenue: vendas.summary.newRevenue, paidRevenue: vendas.summary.newPaidRevenue, color: 'bg-blue-500', pct: vendas.summary.uniqueCustomers > 0 ? ((vendas.summary.newCount / vendas.summary.uniqueCustomers) * 100).toFixed(1) : '0' },
                        ].map(item => (
                          <div key={item.label}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className={`w-3 h-3 rounded-full ${item.color} inline-block`} />
                                <span className="text-sm text-gray-400">{item.label}</span>
                              </div>
                              <span className="text-sm font-bold text-white">{item.pct}%</span>
                            </div>
                            <div className="w-full bg-gray-800 rounded-full h-1.5">
                              <div className={`${item.color} h-1.5 rounded-full`} style={{ width: `${item.pct}%` }} />
                            </div>
                            <div className="flex justify-between mt-1">
                              <span className="text-xs text-gray-500">{item.count} clientes</span>
                              <span className="text-xs text-gray-500">Captado: {fmt(item.revenue)}</span>
                            </div>
                            <div className="flex justify-end mt-0.5">
                              <span className="text-xs text-gray-600">Pago: {fmt(item.paidRevenue)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Receita por tipo */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-4 justify-center">
                    <h2 className="text-sm font-semibold text-gray-300">Receita por tipo</h2>
                    {[
                      { label: 'Recorrentes', color: 'bg-purple-500', revenue: vendas.summary.recurringRevenue, paid: vendas.summary.recurringPaidRevenue, total: vendas.summary.totalRevenueCaptada },
                      { label: 'Novos', color: 'bg-blue-500', revenue: vendas.summary.newRevenue, paid: vendas.summary.newPaidRevenue, total: vendas.summary.totalRevenueCaptada },
                    ].map((item, i) => (
                      <div key={item.label} className={i > 0 ? 'border-t border-gray-800 pt-4' : ''}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`w-3 h-3 rounded-full ${item.color} inline-block`} />
                          <span className="text-xs text-gray-400">{item.label}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-xs text-gray-500 mb-0.5">Captado</p>
                            <p className="text-lg font-bold text-white">{fmt(item.revenue)}</p>
                            <p className="text-xs text-gray-600">{item.total > 0 ? `${((item.revenue / item.total) * 100).toFixed(1)}%` : ''}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-0.5">Pago</p>
                            <p className="text-lg font-bold text-green-400">{fmt(item.paid)}</p>
                            <p className="text-xs text-gray-600">{item.revenue > 0 ? `${((item.paid / item.revenue) * 100).toFixed(1)}% do captado` : ''}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Meios de Pagamento */}
                {(vendas.byPayment?.length ?? 0) > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-gray-300 mb-4">Meios de Pagamento</h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 text-left text-gray-500 text-xs uppercase">
                            <th className="pb-2 pr-4">Meio</th>
                            <th className="pb-2 pr-4 text-center">Pedidos</th>
                            <th className="pb-2 pr-4 text-center">Ped. Pagos</th>
                            <th className="pb-2 pr-4">Captado</th>
                            <th className="pb-2 pr-4">Faturado</th>
                            <th className="pb-2 pr-4">% Conversão</th>
                            <th className="pb-2">% do Faturado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {vendas.byPayment!.map(p => {
                            const convPct = p.captada > 0 ? (p.paga / p.captada * 100) : 0
                            const sharePct = vendas.summary.totalRevenuePaga > 0 ? (p.paga / vendas.summary.totalRevenuePaga * 100) : 0
                            return (
                              <tr key={p.method} className="hover:bg-gray-800/50 transition-colors">
                                <td className="py-2 pr-4 text-gray-200">{p.method}</td>
                                <td className="py-2 pr-4 text-center text-gray-300">{p.orders}</td>
                                <td className="py-2 pr-4 text-center text-gray-300">{p.paidOrders}</td>
                                <td className="py-2 pr-4 text-gray-300">{fmt(p.captada)}</td>
                                <td className="py-2 pr-4 text-green-400 font-medium">{fmt(p.paga)}</td>
                                <td className="py-2 pr-4">
                                  <span className={`text-xs font-semibold ${convPct >= 80 ? 'text-green-400' : convPct >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                                    {convPct.toFixed(1)}%
                                  </span>
                                </td>
                                <td className="py-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-24 bg-gray-800 rounded-full h-1.5">
                                      <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${Math.min(sharePct, 100).toFixed(0)}%` }} />
                                    </div>
                                    <span className="text-xs text-gray-400">{sharePct.toFixed(1)}%</span>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Tabela clientes */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  {/* Toolbar */}
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 className="text-sm font-semibold text-gray-300">
                      Clientes que compraram ({filteredVendas.length}
                      {filteredVendas.length !== (vendas?.customers.length ?? 0) && (
                        <span className="text-gray-500 font-normal"> de {vendas?.customers.length}</span>
                      )})
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => exportToExcel(filteredVendas)}
                        className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors">
                        <Download size={13} /> Excel
                      </button>
                    </div>
                  </div>

                  {/* Filtros */}
                  <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-gray-800/60 rounded-lg border border-gray-700/50">
                    {/* Busca expandida */}
                    <div className="relative flex-1 min-w-[200px]">
                      <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" />
                      <input
                        placeholder="Nome, e-mail, telefone, CNPJ, nome fantasia…"
                        value={vendasSearch}
                        onChange={(e) => setVendasSearch(e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-gray-200 w-full"
                      />
                    </div>

                    {/* Filtro estado */}
                    <select
                      value={vendasStateFilter}
                      onChange={(e) => setVendasStateFilter(e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
                    >
                      <option value="">Todos os estados</option>
                      {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>

                    {/* Filtro tipo */}
                    <select
                      value={vendasFilter}
                      onChange={(e) => setVendasFilter(e.target.value as typeof vendasFilter)}
                      className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
                    >
                      <option value="all">Novo + Recorrente</option>
                      <option value="recurring">Só Recorrentes</option>
                      <option value="new">Só Novos</option>
                    </select>

                    {/* Seletor de colunas */}
                    <div className="relative" ref={colPickerRef}>
                      <button
                        onClick={() => setShowColPicker(v => !v)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors ${showColPicker ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white hover:border-gray-500'}`}
                      >
                        <SlidersHorizontal size={13} />
                        Colunas
                        <span className="ml-1 bg-gray-700 text-gray-300 rounded px-1 text-[10px]">{visibleCols.size}/{VENDAS_COLUMNS.length}</span>
                      </button>

                      {showColPicker && (
                        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-xl p-4 z-20 w-80 shadow-2xl">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-xs text-gray-300 font-semibold">Colunas visíveis</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setVisibleCols(new Set(ALL_COL_KEYS))}
                                className="text-xs text-blue-400 hover:text-blue-300 underline"
                              >Todas</button>
                              <span className="text-gray-600">·</span>
                              <button
                                onClick={() => setVisibleCols(new Set(['name','email','cnpj','tradeName','state','city','isRecurring','totalSpent','paidSpent']))}
                                className="text-xs text-gray-400 hover:text-gray-200 underline"
                              >Compacto</button>
                              <span className="text-gray-600">·</span>
                              <button
                                onClick={() => setVisibleCols(new Set(['name','cnpj','tradeName','state','city','totalSpent','paidSpent']))}
                                className="text-xs text-gray-400 hover:text-gray-200 underline"
                              >Só empresa</button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-y-1 gap-x-2">
                            {VENDAS_COLUMNS.map(col => (
                              <label key={col.key} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white p-1.5 rounded hover:bg-gray-700 select-none">
                                <input
                                  type="checkbox"
                                  checked={visibleCols.has(col.key)}
                                  onChange={() => toggleCol(col.key)}
                                  className="rounded accent-blue-500 cursor-pointer"
                                />
                                {col.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Limpar filtros */}
                    {(vendasSearch || vendasStateFilter || vendasFilter !== 'all') && (
                      <button
                        onClick={() => { setVendasSearch(''); setVendasStateFilter(''); setVendasFilter('all') }}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1.5 rounded border border-red-900/50 hover:border-red-800 transition-colors"
                      >
                        ✕ Limpar
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="text-xs" style={{ minWidth: `${visibleCols.size * 110}px`, width: '100%' }}>
                      <thead>
                        <tr className="border-b border-gray-800 text-left text-gray-500 uppercase whitespace-nowrap">
                          {VENDAS_COLUMNS.filter(col => visibleCols.has(col.key)).map(col => (
                            <th
                              key={col.key}
                              className={`pb-2 pr-3 ${col.sortKey ? 'cursor-pointer hover:text-gray-300' : ''}`}
                              onClick={() => col.sortKey && handleSort(col.sortKey)}
                            >
                              {col.label}
                              {col.sortKey && <SortIcon k={col.sortKey} />}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {filteredVendas.slice(0, 200).map((c) => (
                          <tr key={c.email} className="hover:bg-gray-800/50 transition-colors whitespace-nowrap">
                            {VENDAS_COLUMNS.filter(col => visibleCols.has(col.key)).map(col => renderCell(col, c))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredVendas.length > 200 && (
                      <p className="text-xs text-gray-500 mt-3 text-center">Mostrando 200 de {filteredVendas.length}. Use os filtros para refinar.</p>
                    )}
                    {filteredVendas.length === 0 && (
                      <p className="text-xs text-gray-500 mt-6 text-center py-8">Nenhum cliente encontrado com os filtros aplicados.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
        {/* ── TAB: EVOLUÇÃO ANUAL ── */}
        {tab === 'evolucao' && (
          <>
            {evolucaoError && <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 text-sm">{evolucaoError}</div>}
            {evolucaoLoading && (
              <div className="text-center py-20 text-gray-400 text-sm">
                <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-blue-500" />
                Buscando dados do ano atual e anterior... pode levar alguns segundos.
              </div>
            )}
            {evolucao && (() => {
              const { curYear, prevYear, months } = evolucao
              const curColor = '#3b82f6'
              const prevColor = '#6b7280'
              const chartProps = {
                margin: { top: 5, right: 10, left: 10, bottom: 5 },
              }
              const tooltipStyle = { background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }
              const axisStyle = { fontSize: 11, fill: '#9ca3af' }

              return (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5"><span className="w-8 h-0.5 bg-blue-500 inline-block rounded" />{curYear} (atual)</span>
                    <span className="flex items-center gap-1.5"><span className="w-8 h-0.5 bg-gray-500 inline-block rounded border-dashed" />{prevYear} (anterior)</span>
                  </div>

                  {/* Receita Paga */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-gray-300 mb-1">Receita Paga — {curYear} vs {prevYear}</h2>
                    <p className="text-xs text-gray-500 mb-4">Apenas pedidos com pagamento confirmado</p>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={months} {...chartProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="label" tick={axisStyle} />
                        <YAxis tick={axisStyle} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={tooltipStyle}
                          formatter={(v, name) => [
                            new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)),
                            name
                          ]} />
                        <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                        <Bar dataKey="prevRevenue" name={String(prevYear)} fill={prevColor} radius={[3,3,0,0]} opacity={0.7} />
                        <Bar dataKey="curRevenue"  name={String(curYear)}  fill={curColor}  radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Clientes Novos + Recorrentes */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-gray-300 mb-1">Clientes Novos & Recorrentes — {curYear} vs {prevYear}</h2>
                    <p className="text-xs text-gray-500 mb-4">Barras empilhadas: azul escuro = recorrentes, azul claro = novos</p>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={months} {...chartProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="label" tick={axisStyle} />
                        <YAxis tick={axisStyle} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                        <Bar dataKey="prevRecurring" name={`${prevYear} Recorrentes`} stackId="prev" fill="#4b5563" radius={[0,0,0,0]} />
                        <Bar dataKey="prevNew"       name={`${prevYear} Novos`}       stackId="prev" fill="#9ca3af" radius={[3,3,0,0]} />
                        <Bar dataKey="curRecurring"  name={`${curYear} Recorrentes`}  stackId="cur"  fill="#1d4ed8" radius={[0,0,0,0]} />
                        <Bar dataKey="curNew"        name={`${curYear} Novos`}        stackId="cur"  fill="#60a5fa" radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Litragem */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-gray-300 mb-1">Litragem Vendida — {curYear} vs {prevYear}</h2>
                    <p className="text-xs text-gray-500 mb-4">Volume em litros de pedidos pagos (Kg convertido para L)</p>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={months} {...chartProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="label" tick={axisStyle} />
                        <YAxis tick={axisStyle} tickFormatter={(v) => `${v.toLocaleString('pt-BR')}L`} />
                        <Tooltip contentStyle={tooltipStyle}
                          formatter={(v, name) => [`${Number(v).toLocaleString('pt-BR',{maximumFractionDigits:1})} L`, name]} />
                        <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                        <Bar dataKey="prevVolumeL" name={String(prevYear)} fill={prevColor} radius={[3,3,0,0]} opacity={0.7} />
                        <Bar dataKey="curVolumeL"  name={String(curYear)}  fill="#06b6d4"  radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )
            })()}
          </>
        )}

        {tab === 'produtos' && (
          <>
            {productsError && <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 text-sm">{productsError}</div>}
            {productsLoading && (
              <div className="text-center py-20 text-gray-400 text-sm">
                <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-blue-500" />
                Buscando detalhes dos pedidos... pode levar alguns segundos.
              </div>
            )}
            {products && (
              <>
                {/* KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard icon={<ShoppingCart size={20} />} label="Pedidos Pagos" value={products.totalOrders} color="blue" />
                  <KpiCard icon={<DollarSign size={20} />} label="Receita Total (produtos)" value={fmt(products.totalRevenue)} color="green" />
                  <KpiCard icon={<TrendingUp size={20} />} label="Volume Total" value={`${products.totalVolumeL.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`} color="purple" />
                  <KpiCard icon={<Users size={20} />} label="SKUs únicos" value={products.skus.length} color="yellow" />
                </div>

                {/* Tabela */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <h2 className="text-sm font-semibold text-gray-300">Ranking de SKUs — por receita</h2>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                          className="bg-gray-800 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 w-56 focus:outline-none focus:border-blue-500"
                          placeholder="Buscar produto..."
                          value={productSearch}
                          onChange={e => setProductSearch(e.target.value)}
                        />
                      </div>
                      <button onClick={() => {
                        const ws = XLSX.utils.json_to_sheet(products.skus.map(s => ({
                          'Produto': s.name, 'Pedidos': s.orders, 'Unidades Vendidas': s.unitsSold,
                          'Receita (R$)': s.revenue.toFixed(2), 'Volume (L)': s.volumeL.toFixed(1),
                          '% Receita': products.totalRevenue > 0 ? ((s.revenue / products.totalRevenue) * 100).toFixed(1) + '%' : '—',
                        })))
                        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Produtos')
                        XLSX.writeFile(wb, `ranking-produtos-${products.dateFrom}-${products.dateTo}.xlsx`)
                      }} className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors">
                        <Download size={13} /> Excel
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-800 text-xs">
                          <th className="pb-2 pr-4">#</th>
                          <th className="pb-2 pr-4">Produto</th>
                          <th className="pb-2 pr-4 text-right">Pedidos</th>
                          <th className="pb-2 pr-4 text-right">Unidades</th>
                          <th className="pb-2 pr-4 text-right">Receita</th>
                          <th className="pb-2 pr-4 text-right">% Receita</th>
                          <th className="pb-2 text-right">Volume (L)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.skus
                          .filter(s => productSearch === '' || s.name.toLowerCase().includes(productSearch.toLowerCase()))
                          .map((sku, i) => {
                            const pct = products.totalRevenue > 0 ? (sku.revenue / products.totalRevenue) * 100 : 0
                            return (
                              <tr key={sku.name} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                                <td className="py-2 pr-4 text-gray-500 text-xs">{i + 1}</td>
                                <td className="py-2 pr-4 text-gray-200 max-w-xs">
                                  <div className="truncate" title={sku.name}>{sku.name}</div>
                                  <div className="mt-0.5 h-1 rounded-full bg-gray-800 w-full">
                                    <div className="h-1 rounded-full bg-blue-500" style={{ width: `${Math.min(pct * 3, 100)}%` }} />
                                  </div>
                                </td>
                                <td className="py-2 pr-4 text-right text-gray-300">{sku.orders}</td>
                                <td className="py-2 pr-4 text-right text-gray-300">{sku.unitsSold}</td>
                                <td className="py-2 pr-4 text-right font-medium text-white">{fmt(sku.revenue)}</td>
                                <td className="py-2 pr-4 text-right text-gray-400 text-xs">{pct.toFixed(1)}%</td>
                                <td className="py-2 text-right text-cyan-400">{sku.volumeL > 0 ? `${sku.volumeL.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L` : '—'}</td>
                              </tr>
                            )
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Top 10 por receita — gráfico */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <h2 className="text-sm font-semibold text-gray-300 mb-4">Top 10 Produtos por Receita</h2>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={products.skus.slice(0, 10).map(s => ({ ...s, shortName: s.name.length > 30 ? s.name.slice(0, 30) + '…' : s.name }))}
                      layout="vertical"
                      margin={{ top: 0, right: 20, left: 180, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="shortName" tick={{ fontSize: 11, fill: '#9ca3af' }} width={175} />
                      <Tooltip
                        contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                        formatter={(v) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v)), 'Receita']}
                      />
                      <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'churn' && (
          <>
            {vendasChurnLoading && (
              <div className="text-center py-20 text-gray-400 text-sm">
                <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-blue-500" />
                Carregando dados dos últimos {CHURN_MONTHS} meses...
              </div>
            )}
            {vendasChurnError && <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 text-sm">{vendasChurnError}</div>}
            {vendasChurn && (() => {
              const red    = churnList.filter(c => c.risk === 'red')
              const yellow = churnList.filter(c => c.risk === 'yellow')
              const green  = churnList.filter(c => c.risk === 'green')
              const riskLabel = { red: 'Em risco', yellow: 'Atenção', green: 'Em dia' }
              const riskColor = {
                red:    { bg: 'bg-red-900/30',    border: 'border-red-800/50',    text: 'text-red-400',    dot: 'bg-red-500' },
                yellow: { bg: 'bg-yellow-900/20', border: 'border-yellow-800/40', text: 'text-yellow-400', dot: 'bg-yellow-500' },
                green:  { bg: 'bg-green-900/20',  border: 'border-green-800/40',  text: 'text-green-400',  dot: 'bg-green-500' },
              }
              return (
                <>
                  {/* KPIs */}
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <KpiCard icon={<Repeat2 size={20} />}     label="Recorrentes monitorados" value={churnList.length}         color="blue" />
                    <KpiCard icon={<TrendingUp size={20} />}  label="Em risco (vermelho)"      value={red.length}              color="red" />
                    <KpiCard icon={<ShoppingCart size={20} />} label="Atenção (amarelo)"        value={yellow.length}           color="yellow" />
                    <KpiCard icon={<UserCheck size={20} />}   label="Em dia (verde)"            value={green.length}            color="green" />
                    <KpiCard icon={<Users size={20} />}       label="Compra única"              value={singlePurchaseList.length} color="purple" />
                  </div>

                  <div className="p-3 bg-gray-800/60 border border-gray-700/60 rounded-lg text-xs text-gray-400 flex items-center justify-between flex-wrap gap-2">
                    <span>📅 Período fixo: <strong className="text-gray-200">{churnDateFrom}</strong> → <strong className="text-gray-200">{churnDateTo}</strong> (últimos {CHURN_MONTHS} meses) — independente do filtro de datas acima.</span>
                    <span>🟢 até 30d &nbsp;🟡 31–60d &nbsp;🔴 +60d sem comprar</span>
                  </div>

                  {/* Lista por grupo */}
                  {(['red', 'yellow', 'green'] as const).map(risk => {
                    const baseList = risk === 'red' ? red : risk === 'yellow' ? yellow : green
                    if (baseList.length === 0) return null
                    const c = riskColor[risk]
                    const dir = churnSortDir === 'asc' ? 1 : -1
                    const list = [...baseList].sort((a, b) =>
                      churnSortKey === 'receita' ? (a.paidSpent - b.paidSpent) * dir : (a.diasDesde - b.diasDesde) * dir
                    )
                    const arrow = (k: 'dias' | 'receita') => churnSortKey === k ? (churnSortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'
                    return (
                      <div key={risk} className={`${c.bg} border ${c.border} rounded-xl p-4`}>
                        <div className="flex items-center gap-2 mb-4">
                          <div className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                          <h2 className={`text-sm font-semibold ${c.text}`}>
                            {riskLabel[risk]} — {list.length} cliente{list.length > 1 ? 's' : ''}
                            <span className="ml-2 font-normal text-gray-500 text-xs">
                              {risk === 'red' ? '(+60 dias)' : risk === 'yellow' ? '(31–60 dias)' : '(até 30 dias)'}
                            </span>
                          </h2>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm text-left">
                            <thead>
                              <tr className="text-gray-400 border-b border-gray-700 text-xs">
                                <th className="pb-2 pr-4">Cliente</th>
                                <th className="pb-2 pr-4">CNPJ</th>
                                <th className="pb-2 pr-4">Tipo</th>
                                <th className="pb-2 pr-4">Estado</th>
                                <th className="pb-2 pr-4 text-right">1ª Compra</th>
                                <th className="pb-2 pr-4 text-right">Ped. total</th>
                                <th className="pb-2 pr-4 text-right cursor-pointer select-none hover:text-gray-200" onClick={() => toggleChurnSort('receita')}>Rec. Paga (período){arrow('receita')}</th>
                                <th className="pb-2 pr-4 text-right cursor-pointer select-none hover:text-gray-200" onClick={() => toggleChurnSort('dias')}>Dias s/ comprar{arrow('dias')}</th>
                                <th className="pb-2 text-right">Última compra</th>
                              </tr>
                            </thead>
                            <tbody>
                              {list.map(c2 => (
                                <tr key={c2.email} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                                  <td className="py-2 pr-4">
                                    <div className="text-gray-200 font-medium">{c2.name || c2.email}</div>
                                    {c2.tradeName && <div className="text-gray-500 text-xs">{c2.tradeName}</div>}
                                    <div className="text-gray-500 text-xs">{c2.email}</div>
                                    {c2.phone && <div className="text-gray-600 text-xs">{fmtPhone(c2.phone)}</div>}
                                  </td>
                                  <td className="py-2 pr-4 text-gray-400 text-xs">{c2.cnpj ?? '—'}</td>
                                  <td className="py-2 pr-4"><BizBadge type={c2.businessType} /></td>
                                  <td className="py-2 pr-4 text-gray-400 text-xs">{c2.state ?? '—'}</td>
                                  <td className="py-2 pr-4 text-right text-gray-400 text-xs">{c2.firstOrderDate ? fmtDate(c2.firstOrderDate) : '—'}</td>
                                  <td className="py-2 pr-4 text-right text-gray-300">{c2.totalAllTime}</td>
                                  <td className="py-2 pr-4 text-right text-white font-medium">{fmt(c2.paidSpent)}</td>
                                  <td className={`py-2 pr-4 text-right font-semibold ${riskColor[c2.risk].text}`}>{c2.diasDesde}d</td>
                                  <td className="py-2 text-right text-gray-400 text-xs">{c2.lastOrderDate ? fmtDate(c2.lastOrderDate) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}

                  {/* Single purchase customers */}
                  {singlePurchaseList.length > 0 && (
                    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-2.5 h-2.5 rounded-full bg-gray-500" />
                        <h2 className="text-sm font-semibold text-gray-400">Compra única — {singlePurchaseList.length} cliente{singlePurchaseList.length > 1 ? 's' : ''}</h2>
                        <span className="text-xs text-gray-600">ainda sem recorrência estabelecida</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead>
                            <tr className="text-gray-400 border-b border-gray-700 text-xs">
                              <th className="pb-2 pr-4">Cliente</th>
                              <th className="pb-2 pr-4">CNPJ</th>
                              <th className="pb-2 pr-4">Tipo</th>
                              <th className="pb-2 pr-4">Estado</th>
                              <th className="pb-2 pr-4 text-right">1ª Compra</th>
                              <th className="pb-2 pr-4 text-right">Rec. Paga (período)</th>
                              <th className="pb-2 text-right">Dias s/ comprar</th>
                            </tr>
                          </thead>
                          <tbody>
                            {singlePurchaseList.map(c2 => (
                              <tr key={c2.email} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                                <td className="py-2 pr-4">
                                  <div className="text-gray-300 font-medium">{c2.name || c2.email}</div>
                                  {c2.tradeName && <div className="text-gray-500 text-xs">{c2.tradeName}</div>}
                                  <div className="text-gray-500 text-xs">{c2.email}</div>
                                  {c2.phone && <div className="text-gray-600 text-xs">{fmtPhone(c2.phone)}</div>}
                                </td>
                                <td className="py-2 pr-4 text-gray-400 text-xs">{c2.cnpj ?? '—'}</td>
                                <td className="py-2 pr-4"><BizBadge type={c2.businessType} /></td>
                                <td className="py-2 pr-4 text-gray-400 text-xs">{c2.state ?? '—'}</td>
                                <td className="py-2 pr-4 text-right text-gray-400 text-xs">{c2.firstOrderDate ? fmtDate(c2.firstOrderDate) : '—'}</td>
                                <td className="py-2 pr-4 text-right text-white font-medium">{fmt(c2.paidSpent)}</td>
                                <td className="py-2 text-right text-gray-400">{c2.diasDesde}d</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </>
        )}

      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  color: 'blue' | 'green' | 'red' | 'yellow' | 'purple'
}) {
  const colors = {
    blue: 'bg-blue-900/30 text-blue-400',
    green: 'bg-green-900/30 text-green-400',
    red: 'bg-red-900/30 text-red-400',
    yellow: 'bg-yellow-900/30 text-yellow-400',
    purple: 'bg-purple-900/30 text-purple-400',
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className={`inline-flex p-2 rounded-lg ${colors[color]} mb-3`}>{icon}</div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}
