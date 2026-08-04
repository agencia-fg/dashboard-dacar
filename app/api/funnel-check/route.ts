import { NextResponse } from 'next/server'
import { fetchAllCustomers } from '@/lib/vtex'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Diagnóstico do tracking de funil — protegido pelo middleware (só logado acessa).
// Mostra createdIn vs lastInteractionIn dos cadastros recentes para entender
// por que a etapa "Acessou/Voltou ao site" pode ter parado.
export async function GET() {
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  const customers = await fetchAllCustomers(from, to)

  const MARGIN = 12 * 60 * 60 * 1000
  let comLastInteraction = 0
  let semLastInteraction = 0
  let voltaram = 0
  let interactionIgualCriacao = 0

  const amostra = customers.slice(0, 20).map(c => {
    const created = c.createdIn ? new Date(c.createdIn).getTime() : null
    const inter = c.lastInteractionIn ? new Date(c.lastInteractionIn).getTime() : null
    const deltaH = created && inter ? Math.round((inter - created) / 3600000 * 10) / 10 : null
    return {
      email: c.email,
      createdIn: c.createdIn,
      lastInteractionIn: c.lastInteractionIn ?? null,
      deltaHoras: deltaH,
      voltou: created != null && inter != null && inter > created + MARGIN,
    }
  })

  for (const c of customers) {
    const created = c.createdIn ? new Date(c.createdIn).getTime() : null
    const inter = c.lastInteractionIn ? new Date(c.lastInteractionIn).getTime() : null
    if (inter == null) { semLastInteraction++; continue }
    comLastInteraction++
    if (created != null) {
      if (Math.abs(inter - created) < 60000) interactionIgualCriacao++
      if (inter > created + MARGIN) voltaram++
    }
  }

  return NextResponse.json({
    periodo: { from, to },
    totalCadastros: customers.length,
    comLastInteraction,
    semLastInteraction,
    interactionIgualCriacao,
    voltaramAoSite: voltaram,
    amostra,
  })
}
