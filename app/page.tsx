'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, subDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, FunnelChart, Funnel, LabelList,
} from 'recharts'
import { Users, ShoppingCart, TrendingUp, DollarSign, RefreshCw, Search } from 'lucide-react'

interface Summary {
  totalCustomers: number
  purchasedCount: number
  neverPurchasedCount: number
  conversionRate: number
  totalRevenue: number
}

interface DayData {
  date: string
  registrations: number
  purchases: number
}

interface Customer {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  createdIn: string
  purchased: boolean
  orderCount: number
  totalSpent: number
  firstPurchaseDate: string | null
}

interface DashboardData {
  summary: Summary
  byDay: DayData[]
  customers: Customer[]
}

const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

const fmtDate = (iso: string) =>
  format(new Date(iso), 'dd/MM/yyyy', { locale: ptBR })

export default function Dashboard() {
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'purchased' | 'not_purchased'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/dashboard?from=${dateFrom}&to=${dateTo}`)
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const filteredCustomers = (data?.customers ?? []).filter((c) => {
    const matchSearch =
      search === '' ||
      c.email?.toLowerCase().includes(search.toLowerCase()) ||
      c.firstName?.toLowerCase().includes(search.toLowerCase()) ||
      c.lastName?.toLowerCase().includes(search.toLowerCase())
    const matchStatus =
      filterStatus === 'all' ||
      (filterStatus === 'purchased' && c.purchased) ||
      (filterStatus === 'not_purchased' && !c.purchased)
    return matchSearch && matchStatus
  })

  const funnelData = data
    ? [
        { name: 'Cadastros', value: data.summary.totalCustomers, fill: '#3b82f6' },
        { name: 'Compraram', value: data.summary.purchasedCount, fill: '#10b981' },
      ]
    : []

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Dacar Tintas — Dashboard de Conversão</h1>
          <p className="text-sm text-gray-400">Cadastros vs. Compras</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
          />
          <span className="text-gray-500">até</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
          />
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-1.5 rounded text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Carregando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

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
                <input
                  placeholder="Buscar por nome ou e-mail"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-gray-200 w-64"
                />
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200"
              >
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
                  <th className="pb-2 pr-4">Nome</th>
                  <th className="pb-2 pr-4">E-mail</th>
                  <th className="pb-2 pr-4">Telefone</th>
                  <th className="pb-2 pr-4">Cadastro</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Pedidos</th>
                  <th className="pb-2 pr-4">Total gasto</th>
                  <th className="pb-2">1ª Compra</th>
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
              <p className="text-xs text-gray-500 mt-3 text-center">
                Mostrando 200 de {filteredCustomers.length} clientes. Use os filtros para refinar.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  color: 'blue' | 'green' | 'red' | 'yellow'
}) {
  const colors = {
    blue: 'bg-blue-900/30 text-blue-400',
    green: 'bg-green-900/30 text-green-400',
    red: 'bg-red-900/30 text-red-400',
    yellow: 'bg-yellow-900/30 text-yellow-400',
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
