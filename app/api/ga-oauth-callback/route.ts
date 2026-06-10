import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'Sem código de autorização' }, { status: 400 })

  const clientId     = process.env.GA_OAUTH_CLIENT_ID!
  const clientSecret = process.env.GA_OAUTH_CLIENT_SECRET!
  const redirectUri  = `${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dashboard-dacar.vercel.app'}/api/ga-oauth-callback`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  })

  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json({ error: 'Falha ao trocar código', detail: data }, { status: 500 })
  }

  return new NextResponse(`
    <html><body style="font-family:monospace;background:#111;color:#eee;padding:40px">
      <h2 style="color:#4ade80">✅ Autorizado com sucesso!</h2>
      <p>Adicione esta variável no Vercel:</p>
      <p><strong>GA_OAUTH_REFRESH_TOKEN</strong></p>
      <pre style="background:#1f2937;padding:16px;border-radius:8px;word-break:break-all;font-size:13px">${data.refresh_token}</pre>
      <p style="color:#9ca3af;font-size:13px">Depois de salvar no Vercel, esta rota pode ser removida.</p>
    </body></html>
  `, { headers: { 'Content-Type': 'text/html' } })
}
