'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { format, subDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, FunnelChart, Funnel, LabelList, PieChart, Pie, Cell,
} from 'recharts'
import { Users, ShoppingCart, TrendingUp, DollarSign, RefreshCw, Search, Repeat2, UserCheck, Download } from 'lucide-react'
import * as XLSX from 'xlsx'

// ── Types ──────────────────────────────────────────────────────────
interface Summary {
  totalCustomers: number
  approvedCount: number
  purchasedCount: number
  neverPurchasedCount: number
  conversionRate: number
  totalRevenue: number
}
interface DayData { date: string; registrations: number; purchases: number }
interface Customer {
  id: string; firstName: string; lastName: string; email: string; phone: string
  createdIn: string; purchased: boolean; orderCount: number; totalSpent: number
  firstPurchaseDate: string | null
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
}
interface VendasCustomer {
  email: string; name: string; phone: string; ordersInPeriod: number; totalSpent: number; paidSpent: number
  firstOrderDate: string; lastOrderDate: string; totalAllTime: number; isRecurring: boolean; ordersBeforePeriod: number
  registeredAt: string | null; daysToPurchase: number | null; avgDaysBetweenOrders: number | null
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null
  cnpj: string | null; corporateName: string | null; tradeName: string | null
  city: string | null; state: string | null; approved: boolean | null
}
interface RegionData { state: string; count: number; revenue: number }
interface VendasData { summary: VendasSummary; customers: VendasCustomer[]; regionData: RegionData[] }

// ── Helpers ────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
const fmtDate = (iso: string) => format(new Date(iso), 'dd/MM/yyyy', { locale: ptBR })

function fmtPhone(phone: string): string {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  // Remove DDI 55 se presente
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
    'Razão Social': c.corporateName ?? '',
    'Nome Fantasia': c.tradeName ?? '',
    'Cidade': c.city ?? '',
    'Estado': c.state ?? '',
    'Tipo': c.isRecurring ? 'Recorrente' : 'Novo',
    'Cadastro': c.registeredAt ? fmtDate(c.registeredAt) : '',
    '1ª Compra': c.firstOrderDate ? fmtDate(c.firstOrderDate) : '',
    'Última Compra': c.lastOrderDate ? fmtDate(c.lastOrderDate) : '',
    'Dias Cad.→Compra': c.daysToPurchase ?? '',
    'Freq. Média (dias)': c.avgDaysBetweenOrders ?? '',
    'Ped. Período': c.ordersInPeriod,
    'Total Histórico': c.totalAllTime,
    'Captado (R$)': c.totalSpent,
    'Pago (R$)': c.paidSpent,
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
  const [tab, setTab] = useState<'cadastros' | 'vendas' | 'regioes'>('cadastros')
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))

  // Cadastros tab
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'purchased' | 'not_purchased'>('all')

  // Vendas tab
  const [vendas, setVendas] = useState<VendasData | null>(null)
  const [vendasLoading, setVendasLoading] = useState(false)
  const [vendasError, setVendasError] = useState('')

  // Funil
  const [funnelData, setFunnelData] = useState<FunnelData | null>(null)
  const [funnelLoading, setFunnelLoading] = useState(false)
  const [vendasSearch, setVendasSearch] = useState('')
  const [vendasFilter, setVendasFilter] = useState<'all' | 'recurring' | 'new'>('all')
  const [sortKey, setSortKey] = useState<keyof VendasCustomer>('totalSpent')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

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

  useEffect(() => { loadCadastros() }, [loadCadastros])

  const handleTabChange = (t: 'cadastros' | 'vendas' | 'regioes') => {
    setTab(t)
    if ((t === 'vendas' || t === 'regioes') && !vendas) loadVendas()
  }

  const handleUpdate = () => {
    if (tab === 'cadastros') loadCadastros()
    else { setVendas(null); loadVendas() }
  }

  const filteredCustomers = (data?.customers ?? []).filter((c) => {
    const matchSearch = search === '' || c.email?.toLowerCase().includes(search.toLowerCase()) ||
      c.firstName?.toLowerCase().includes(search.toLowerCase()) || c.lastName?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || (filterStatus === 'purchased' && c.purchased) || (filterStatus === 'not_purchased' && !c.purchased)
    return matchSearch && matchStatus
  })

  const filteredVendas = useMemo(() => {
    const filtered = (vendas?.customers ?? []).filter((c) => {
      const matchSearch = vendasSearch === '' || c.email?.toLowerCase().includes(vendasSearch.toLowerCase()) || c.name?.toLowerCase().includes(vendasSearch.toLowerCase())
      const matchFilter = vendasFilter === 'all' || (vendasFilter === 'recurring' && c.isRecurring) || (vendasFilter === 'new' && !c.isRecurring)
      return matchSearch && matchFilter
    })
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [vendas, vendasSearch, vendasFilter, sortKey, sortDir])

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

  const isLoading = tab === 'cadastros' ? loading : vendasLoading

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Dacar Tintas — Dashboard</h1>
          <div className="flex gap-1 mt-2">
            {([['cadastros','Cadastros vs. Compras'],['vendas','Vendas & Recorrência'],['regioes','Regiões']] as const).map(([t, label]) => (
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
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* ── TAB: CADASTROS ── */}
        {tab === 'cadastros' && (
          <>
            {error && <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 text-sm">{error}</div>}

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard icon={<Users size={20} />} label="Total de Cadastros" value={data?.summary.totalCustomers ?? '—'} color="blue" />
              <KpiCard icon={<UserCheck size={20} />} label="Cadastros Aprovados" value={data?.summary.approvedCount ?? '—'} sub={data?.summary.approvedCount != null ? `${((data.summary.approvedCount / data.summary.totalCustomers) * 100).toFixed(0)}% do total` : undefined} color="green" />
              <KpiCard icon={<ShoppingCart size={20} />} label="Compraram" value={data?.summary.purchasedCount ?? '—'} sub={data ? `${data.summary.conversionRate}% de conversão` : undefined} color="purple" />
              <KpiCard icon={<TrendingUp size={20} />} label="Não compraram" value={data?.summary.neverPurchasedCount ?? '—'} sub={data ? `${(100 - data.summary.conversionRate).toFixed(1)}% do total` : undefined} color="red" />
              <KpiCard icon={<DollarSign size={20} />} label="Receita no Período" value={data ? fmt(data.summary.totalRevenue) : '—'} color="yellow" />
            </div>

            {/* Funil de etapas */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-gray-300 mb-6">Funil de Conversão — Jornada do Cliente</h2>
              {funnelData ? (
                <div className="flex flex-col gap-2">
                  {funnelData.funnel.map((step, i) => {
                    const maxCount = funnelData.funnel[0].count
                    const barWidth = maxCount > 0 ? (step.count / maxCount) * 100 : 0
                    return (
                      <div key={step.step}>
                        <div className="flex items-center gap-4 mb-1">
                          <span className="text-xs text-gray-500 w-24 text-right">{step.label}</span>
                          <div className="flex-1 relative">
                            <div className="h-10 rounded-lg flex items-center px-4 transition-all"
                              style={{ width: `${Math.max(barWidth, 8)}%`, backgroundColor: step.color + '33', border: `1px solid ${step.color}55` }}>
                              <span className="text-white font-bold text-sm whitespace-nowrap">{step.count.toLocaleString('pt-BR')}</span>
                            </div>
                          </div>
                          <div className="w-32 text-right">
                            {step.pct !== undefined && (
                              <span className="text-xs font-semibold" style={{ color: step.color }}>
                                {step.pct.toFixed(1)}% da etapa anterior
                              </span>
                            )}
                          </div>
                        </div>
                        {i < funnelData.funnel.length - 1 && (
                          <div className="ml-24 pl-4 text-xs text-gray-600 mb-1">↓ {(funnelData.funnel[0].count > 0 ? ((funnelData.funnel[i + 1].count / funnelData.funnel[0].count) * 100) : 0).toFixed(1)}% do total de cadastros</div>
                        )}
                      </div>
                    )
                  })}
                  <div className="mt-4 pt-4 border-t border-gray-800 flex gap-6 text-sm">
                    <div><span className="text-gray-500">Conversão total: </span><span className="font-bold text-white">{funnelData.conversionRate}%</span></div>
                    <div><span className="text-gray-500">Total de pedidos: </span><span className="font-bold text-white">{funnelData.totalOrders}</span></div>
                    <div><span className="text-gray-500">Receita paga: </span><span className="font-bold text-green-400">{fmt(funnelData.paidRevenue)}</span></div>
                  </div>
                  <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-800/40 rounded-lg text-xs text-yellow-400/80">
                    ⚠️ <strong>"Iniciaram checkout"</strong> e <strong>"Chegaram ao pagamento"</strong> incluem clientes que compraram em datas anteriores ao período (o pedido existe mas o cadastro é mais antigo). Para um funil preciso de Login e Carrinho, é necessário implementar eventos no GTM.
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 text-sm">Carregando funil...</div>
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
                    <input placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-gray-200 w-64" />
                  </div>
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200">
                    <option value="all">Todos</option>
                    <option value="purchased">Compraram</option>
                    <option value="not_purchased">Não compraram</option>
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-left text-gray-500 text-xs uppercase">
                      <th className="pb-2 pr-4">Nome</th><th className="pb-2 pr-4">E-mail</th>
                      <th className="pb-2 pr-4">Telefone</th><th className="pb-2 pr-4">Cadastro</th>
                      <th className="pb-2 pr-4">Status</th><th className="pb-2 pr-4">Pedidos</th>
                      <th className="pb-2 pr-4">Total gasto</th><th className="pb-2">1ª Compra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {filteredCustomers.slice(0, 200).map((c) => (
                      <tr key={c.id} className="hover:bg-gray-800/50 transition-colors">
                        <td className="py-2 pr-4 text-gray-200">{c.firstName} {c.lastName}</td>
                        <td className="py-2 pr-4 text-gray-400">{c.email}</td>
                        <td className="py-2 pr-4 text-gray-400">{fmtPhone(c.phone)}</td>
                        <td className="py-2 pr-4 text-gray-400">{c.createdIn ? fmtDate(c.createdIn) : '—'}</td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.purchased ? 'bg-green-900/60 text-green-400' : 'bg-red-900/60 text-red-400'}`}>
                            {c.purchased ? 'Comprou' : 'Não comprou'}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-center text-gray-300">{c.orderCount}</td>
                        <td className="py-2 pr-4 text-gray-300">{c.totalSpent > 0 ? fmt(c.totalSpent) : '—'}</td>
                        <td className="py-2 text-gray-400">{c.firstPurchaseDate ? fmtDate(c.firstPurchaseDate) : '—'}</td>
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
                      const ws = XLSX.utils.json_to_sheet(vendas.regionData.map(r => ({ Estado: r.state, Clientes: r.count, 'Receita (R$)': r.revenue.toFixed(2) })))
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
                          <th className="pb-2 pr-4">Receita Captada</th>
                          <th className="pb-2">% do Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {vendas.regionData.map(r => (
                          <tr key={r.state} className="hover:bg-gray-800/50">
                            <td className="py-2 pr-4 text-gray-200 font-medium">{r.state}</td>
                            <td className="py-2 pr-4 text-gray-300">{r.count}</td>
                            <td className="py-2 pr-4 text-gray-300">{fmt(r.revenue)}</td>
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
              💡 Esta aba mostra <strong className="text-gray-300">todos os pedidos do período</strong>, independente de quando o cliente se cadastrou. A aba "Cadastros vs. Compras" mostra apenas clientes que se cadastraram no período selecionado.
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

                {/* Tabela clientes */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <h2 className="text-sm font-semibold text-gray-300">Clientes que compraram ({filteredVendas.length})</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => exportToExcel(filteredVendas)}
                        className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors">
                        <Download size={13} /> Excel
                      </button>
                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" />
                        <input placeholder="Buscar por nome ou e-mail" value={vendasSearch} onChange={(e) => setVendasSearch(e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-gray-200 w-64" />
                      </div>
                      <select value={vendasFilter} onChange={(e) => setVendasFilter(e.target.value as typeof vendasFilter)}
                        className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200">
                        <option value="all">Todos</option>
                        <option value="recurring">Recorrentes</option>
                        <option value="new">Novos</option>
                      </select>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="text-xs" style={{ minWidth: '1100px', width: '100%' }}>
                      <thead>
                        <tr className="border-b border-gray-800 text-left text-gray-500 uppercase whitespace-nowrap">
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('name')}>Nome<SortIcon k="name" /></th>
                          <th className="pb-2 pr-3">E-mail</th>
                          <th className="pb-2 pr-3">Telefone</th>
                          <th className="pb-2 pr-3">CNPJ</th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('tradeName')}>Nome Fantasia<SortIcon k="tradeName" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('state')}>Estado<SortIcon k="state" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('city')}>Cidade<SortIcon k="city" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('isRecurring')}>Tipo<SortIcon k="isRecurring" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('registeredAt')}>Cadastro<SortIcon k="registeredAt" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('firstOrderDate')}>1ª Compra<SortIcon k="firstOrderDate" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('lastOrderDate')}>Última Compra<SortIcon k="lastOrderDate" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('daysToPurchase')}>→Compra<SortIcon k="daysToPurchase" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('ordersInPeriod')}>Ped.<SortIcon k="ordersInPeriod" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('totalAllTime')}>Hist.<SortIcon k="totalAllTime" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('avgDaysBetweenOrders')}>Freq. média<SortIcon k="avgDaysBetweenOrders" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('totalSpent')}>Captado<SortIcon k="totalSpent" /></th>
                          <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300" onClick={() => handleSort('paidSpent')}>Pago<SortIcon k="paidSpent" /></th>
                          <th className="pb-2 pr-3">UTM Source</th>
                          <th className="pb-2 pr-3">UTM Medium</th>
                          <th className="pb-2">UTM Campaign</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {filteredVendas.slice(0, 200).map((c) => (
                          <tr key={c.email} className="hover:bg-gray-800/50 transition-colors whitespace-nowrap">
                            <td className="py-2 pr-3 text-gray-200">{c.name}</td>
                            <td className="py-2 pr-3 text-gray-400">{c.email}</td>
                            <td className="py-2 pr-3 text-gray-400">{fmtPhone(c.phone)}</td>
                            <td className="py-2 pr-3 text-gray-400">{c.cnpj || '—'}</td>
                            <td className="py-2 pr-3 text-gray-300">{c.tradeName || c.corporateName || '—'}</td>
                            <td className="py-2 pr-3 text-gray-400">{c.state || '—'}</td>
                            <td className="py-2 pr-3 text-gray-400">{c.city || '—'}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.isRecurring ? 'bg-purple-900/60 text-purple-400' : 'bg-blue-900/60 text-blue-400'}`}>
                                {c.isRecurring ? 'Recorrente' : 'Novo'}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-gray-400">{c.registeredAt ? fmtDate(c.registeredAt) : '—'}</td>
                            <td className="py-2 pr-3 text-gray-400">{c.firstOrderDate ? fmtDate(c.firstOrderDate) : '—'}</td>
                            <td className="py-2 pr-3 text-gray-400">{c.lastOrderDate ? fmtDate(c.lastOrderDate) : '—'}</td>
                            <td className="py-2 pr-3 text-center">
                              {c.daysToPurchase !== null
                                ? <span className={`font-medium ${c.daysToPurchase === 0 ? 'text-green-400' : c.daysToPurchase <= 7 ? 'text-yellow-400' : 'text-orange-400'}`}>
                                    {c.daysToPurchase === 0 ? 'Mesmo dia' : `${c.daysToPurchase}d`}
                                  </span>
                                : <span className="text-gray-600">—</span>}
                            </td>
                            <td className="py-2 pr-3 text-center text-gray-300">{c.ordersInPeriod}</td>
                            <td className="py-2 pr-3 text-center">
                              <span className={c.totalAllTime > 1 ? 'text-purple-400 font-semibold' : 'text-gray-400'}>{c.totalAllTime}</span>
                            </td>
                            <td className="py-2 pr-3 text-center">
                              {c.avgDaysBetweenOrders !== null
                                ? <span className={`font-medium ${c.avgDaysBetweenOrders <= 30 ? 'text-green-400' : c.avgDaysBetweenOrders <= 90 ? 'text-yellow-400' : 'text-gray-400'}`}>
                                    a cada {c.avgDaysBetweenOrders}d
                                  </span>
                                : <span className="text-gray-600">—</span>}
                            </td>
                            <td className="py-2 pr-3 text-gray-300">{fmt(c.totalSpent)}</td>
                            <td className="py-2 pr-3 text-gray-300">{c.paidSpent > 0 ? fmt(c.paidSpent) : '—'}</td>
                            <td className="py-2 pr-3 text-gray-400">{c.utmSource || '—'}</td>
                            <td className="py-2 pr-3 text-gray-400">{c.utmMedium || '—'}</td>
                            <td className="py-2 text-gray-400">{c.utmCampaign || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredVendas.length > 200 && (
                      <p className="text-xs text-gray-500 mt-3 text-center">Mostrando 200 de {filteredVendas.length}. Use os filtros para refinar.</p>
                    )}
                  </div>
                </div>
              </>
            )}
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
