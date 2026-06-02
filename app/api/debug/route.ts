import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ACCOUNT = process.env.VTEX_ACCOUNT!
const APP_KEY = process.env.VTEX_APP_KEY!
const APP_TOKEN = process.env.VTEX_APP_TOKEN!

const headers = {
  'X-VTEX-API-AppKey': APP_KEY,
  'X-VTEX-API-AppToken': APP_TOKEN,
  'Content-Type': 'application/json',
}

export async function GET() {
  const results: Record<string, unknown> = {}

  // Pega o ID do pedido mais recente
  try {
    const listUrl = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders?per_page=1&page=1`
    const listRes = await fetch(listUrl, { headers })
    const listData = await listRes.json()
    const orderId = listData?.list?.[0]?.orderId
    results.latest_order_id = orderId

    if (orderId) {
      // Pega o detalhe completo do pedido — mostra marketingData, customData, etc.
      const detailUrl = `https://${ACCOUNT}.vtexcommercestable.com.br/api/oms/pvt/orders/${orderId}`
      const detailRes = await fetch(detailUrl, { headers })
      const detail = await detailRes.json()

      results.marketing_data = detail?.marketingData ?? 'NULL'
      results.custom_data = detail?.customData ?? 'NULL'
      results.order_form_id = detail?.orderFormId ?? 'NULL'
      // Campos do topo do pedido que podem ter UTM
      results.utm_fields_in_order = {
        marketingData: detail?.marketingData,
        utmSource: detail?.utmSource,
        utmMedium: detail?.utmMedium,
        utmCampaign: detail?.utmCampaign,
        salesChannel: detail?.salesChannel,
        origin: detail?.origin,
      }
    }
  } catch (e) { results.order_detail_error = String(e) }

  return NextResponse.json(results, { status: 200 })
}
