/**
 * Fantrax API Proxy — Cloudflare Pages Function
 *
 * Handles all requests to /fantrax/* and forwards them to www.fantrax.com.
 * The browser can't call Fantrax directly due to CORS, so this function acts
 * as a same-origin proxy.
 *
 * Security:
 *  - ALLOWED_PATHS: only the 4 endpoints the app needs are forwarded
 *  - ALLOWED_FXPA_METHODS: POST bodies validated to block arbitrary Fantrax API calls
 *  - CORS: restricted to the deployed site URL (set SITE_URL in Cloudflare env vars)
 */

const ALLOWED_PATHS = new Set([
  '/fxea/general/getStandings',
  '/fxpa/req',
  '/fxea/general/getPlayerIds',
  '/fxea/general/getTeamRosters',
])

const ALLOWED_FXPA_METHODS = new Set(['getStandings', 'getDraftResults'])

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/^\/fantrax/, '')

  if (!ALLOWED_PATHS.has(pathname)) {
    return new Response('Not allowed', { status: 403, headers: { 'Content-Type': 'text/plain' } })
  }

  const options = { method: request.method, headers: { 'Content-Type': 'application/json' } }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bodyText = await request.text()

    if (pathname === '/fxpa/req') {
      try {
        const parsed = JSON.parse(bodyText)
        const fxpaMethod = parsed?.msgs?.[0]?.method
        if (!ALLOWED_FXPA_METHODS.has(fxpaMethod)) {
          return new Response('Not allowed', { status: 403, headers: { 'Content-Type': 'text/plain' } })
        }
      } catch {
        return new Response('Bad request', { status: 400, headers: { 'Content-Type': 'text/plain' } })
      }
    }

    options.body = bodyText
  }

  const origin = request.headers.get('Origin') || ''
  const siteUrl = env.SITE_URL || ''
  const allowOrigin = (siteUrl && origin === siteUrl) || origin.startsWith('http://localhost')
    ? origin
    : siteUrl || '*'

  const fantraxUrl = `https://www.fantrax.com${pathname}${url.search}`

  try {
    const res = await fetch(fantraxUrl, options)
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowOrigin },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowOrigin },
    })
  }
}
