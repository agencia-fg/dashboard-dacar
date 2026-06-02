'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, subDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, FunnelChart, Funnel, LabelList, PieChart, Pie, Cell,
} from 'recharts'
import { Users, ShoppingCart, TrendingUp, DollarSign, RefreshCw, Search, Repeat2, UserCheck } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────
interface Summary {
  totalCustomers: number
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

interface VendasSummary {
  totalOrders: number; totalRevenue: number; uniqueCustomers: number
  recurringCount: number; newCount: number
  recurringRevenue: number; newRevenue: number
  avgDaysToPurchase: number | null
  isSample: boolean; sampleSize: number
}
interface VendasCustomer {
  email: string; name: string; phone: string; ordersInPeriod: number; totalSpent: number
  firstOrderDate: string; totalAllTime: number; isRecurring: boolean; ordersBeforePeriod: number
  registeredAt: string | null; daysToPurchase: number | null
}
interface VendasData { summary: VendasSummary; customers: VendasCustomer[] }

// ── Helpers ────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
const fmtDate = (iso: string) => format(new Date(iso), 'dd/MM/yyyy', { locale: ptBR })

// ── Main Component ─────────────────────────────────────────────────
export default function Dashboard() {
  const [tab, setTab] = useState<'cadastros' | 'vendas'>('cadastros')
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
  const [vendasSearch, setVendasSearch] = useState('')
  const [vendasFilter, setVendasFilter] = useState<'all' | 'recurring' | 'new'>('all')

  const loadCadastros = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/dashboard?from=${dateFrom}&to=${dateTo}`)
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
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

  const handleTabChange = (t: 'cadastros' | 'vendas') => {
    setTab(t)
    if (t === 'vendas' && !vendas) loadVendas()
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

  const filteredVendas = (vendas?.customers ?? []).filter((c) => {
    const matchSearch = vendasSearch === '' || c.email?.toLowerCase().includes(vendasSearch.toLowerCase()) || c.name?.toLowerCase().includes(vendasSearch.toLowerCase())
    const matchFilter = vendasFilter === 'all' || (vendasFilter === 'recurring' && c.isRecurring) || (vendasFilter === 'new' && !c.isRecurring)
    return matchSearch && matchFilter
  })

  const funnelData = data
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
            {(['cadastros', 'vendas'] as const).map(t => (
              <button key={t} onClick={() => handleTabChange(t)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                {t === 'cadastros' ? 'Cadastros vs. Compras' : 'Vendas & Recorrência'}
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

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard icon={<Users size={20} />} label="Total de Cadastros" value={data?.summary.totalCustomers ?? '—'} color="blue" />
              <KpiCard icon={<ShoppingCart size={20} />} label="Compraram" value={data?.summary.purchasedCount ?? '—'} sub={data ? `${data.summary.conversionRate}% de conversão` : undefined} color="green" />
              <KpiCard icon={<TrendingUp size={20} />} label="Não compraram" value={data?.summary.neverPurchasedCount ?? '—'} sub={data ? `${(100 - data.summary.conversionRate).toFixed(1)}% do total` : undefined} color="red" />
              <KpiCard icon={<DollarSign size={20} />} label="Receita no Período" value={data ? fmt(data.summary.totalRevenue) : '—'} color="yellow" />
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
                        <Funnel dataKey="value" data={funnelData} isAnimationActive>
                          <LabelList position="center" fill="#fff" fontSize={13} />
                        </Funnel>
                      </FunnelChart>
                    </ResponsiveContainer>
                    <div className="mt-3 space-y-2">
                      {funnelData.map((f) => (
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
                        <td className="py-2 pr-4 text-gray-400">{c.phone ?? '—'}</td>
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
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <KpiCard icon={<ShoppingCart size={20} />} label="Total de Pedidos" value={vendas.summary.totalOrders} color="blue" />
                  <KpiCard icon={<DollarSign size={20} />} label="Receita Total" value={fmt(vendas.summary.totalRevenue)} color="yellow" />
                  <KpiCard icon={<Repeat2 size={20} />} label="Clientes Recorrentes" value={vendas.summary.recurringCount}
                    sub={vendas.summary.uniqueCustomers > 0 ? `${((vendas.summary.recurringCount / vendas.summary.uniqueCustomers) * 100).toFixed(1)}% dos compradores` : undefined} color="purple" />
                  <KpiCard icon={<UserCheck size={20} />} label="Clientes Novos" value={vendas.summary.newCount}
                    sub={vendas.summary.uniqueCustomers > 0 ? `${((vendas.summary.newCount / vendas.summary.uniqueCustomers) * 100).toFixed(1)}% dos compradores` : undefined} color="green" />
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
                          { label: 'Recorrentes', count: vendas.summary.recurringCount, revenue: vendas.summary.recurringRevenue, color: 'bg-purple-500', pct: vendas.summary.uniqueCustomers > 0 ? ((vendas.summary.recurringCount / vendas.summary.uniqueCustomers) * 100).toFixed(1) : '0' },
                          { label: 'Novos', count: vendas.summary.newCount, revenue: vendas.summary.newRevenue, color: 'bg-blue-500', pct: vendas.summary.uniqueCustomers > 0 ? ((vendas.summary.newCount / vendas.summary.uniqueCustomers) * 100).toFixed(1) : '0' },
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
                              <span className="text-xs text-gray-500">{fmt(item.revenue)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Receita por tipo */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-gray-300 mb-4">Receita: Recorrentes vs. Novos</h2>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={[{ name: 'Recorrentes', value: vendas.summary.recurringRevenue }, { name: 'Novos', value: vendas.summary.newRevenue }]}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} formatter={(v) => fmt(Number(v))} />
                        <Bar dataKey="value" name="Receita" radius={[6, 6, 0, 0]}>
                          <Cell fill="#8b5cf6" />
                          <Cell fill="#3b82f6" />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Tabela clientes */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <h2 className="text-sm font-semibold text-gray-300">Clientes que compraram ({filteredVendas.length})</h2>
                    <div className="flex items-center gap-2">
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
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-left text-gray-500 text-xs uppercase">
                          <th className="pb-2 pr-4">Nome</th>
                          <th className="pb-2 pr-4">E-mail</th>
                          <th className="pb-2 pr-4">Telefone</th>
                          <th className="pb-2 pr-4">Tipo</th>
                          <th className="pb-2 pr-4">Cadastro</th>
                          <th className="pb-2 pr-4">1ª Compra</th>
                          <th className="pb-2 pr-4">Dias cadastro→compra</th>
                          <th className="pb-2 pr-4">Ped. período</th>
                          <th className="pb-2 pr-4">Histórico</th>
                          <th className="pb-2">Gasto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {filteredVendas.slice(0, 200).map((c) => (
                          <tr key={c.email} className="hover:bg-gray-800/50 transition-colors">
                            <td className="py-2 pr-4 text-gray-200">{c.name}</td>
                            <td className="py-2 pr-4 text-gray-400">{c.email}</td>
                            <td className="py-2 pr-4 text-gray-400">{c.phone || '—'}</td>
                            <td className="py-2 pr-4">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.isRecurring ? 'bg-purple-900/60 text-purple-400' : 'bg-blue-900/60 text-blue-400'}`}>
                                {c.isRecurring ? 'Recorrente' : 'Novo'}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-gray-400 text-xs">{c.registeredAt ? fmtDate(c.registeredAt) : '—'}</td>
                            <td className="py-2 pr-4 text-gray-400 text-xs">{c.firstOrderDate ? fmtDate(c.firstOrderDate) : '—'}</td>
                            <td className="py-2 pr-4 text-center">
                              {c.daysToPurchase !== null
                                ? <span className={`text-xs font-medium ${c.daysToPurchase === 0 ? 'text-green-400' : c.daysToPurchase <= 7 ? 'text-yellow-400' : 'text-orange-400'}`}>
                                    {c.daysToPurchase === 0 ? 'Mesmo dia' : `${c.daysToPurchase}d`}
                                  </span>
                                : <span className="text-gray-600 text-xs">—</span>}
                            </td>
                            <td className="py-2 pr-4 text-center text-gray-300">{c.ordersInPeriod}</td>
                            <td className="py-2 pr-4 text-center">
                              <span className={c.totalAllTime > 1 ? 'text-purple-400 font-semibold text-xs' : 'text-gray-400 text-xs'}>{c.totalAllTime}</span>
                            </td>
                            <td className="py-2 text-gray-300">{fmt(c.totalSpent)}</td>
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
