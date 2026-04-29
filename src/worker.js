/**
 * Cloudflare Worker entry point
 *
 * Routes /fantrax/* requests through the Fantrax API proxy.
 * Everything else is served from the built React app (dist/).
 *
 * Set SITE_URL in Cloudflare Workers & Pages → Settings → Variables & Secrets
 * to your deployed domain so CORS is restricted to your site only.
 */

const ALLOWED_PATHS = new Set([
  '/fxea/general/getStandings',
  '/fxpa/req',
  '/fxea/general/getPlayerIds',
  '/fxea/general/getTeamRosters',
])

const ALLOWED_FXPA_METHODS = new Set(['getStandings', 'getDraftResults'])

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/fantrax/')) {
      return handleFantraxProxy(request, env)
    }

    // Fall through to static assets (the React app)
    return env.ASSETS.fetch(request)
  },
}

async function handleFantraxProxy(request, env) {
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
