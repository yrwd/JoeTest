/**
 * Fantrax API Proxy — Netlify Edge Function
 *
 * Routes /fantrax/* requests to www.fantrax.com.
 * We can't use Netlify's [[redirects]] proxy here because it silently drops
 * POST bodies, which breaks the fxpa endpoints. This edge function preserves
 * the full request including body.
 *
 * Security measures:
 *  - ALLOWED_PATHS: only the 4 endpoints the app actually needs are forwarded
 *  - ALLOWED_FXPA_METHODS: POST bodies to /fxpa/req are validated so callers
 *    can't use our proxy to invoke arbitrary Fantrax API methods
 *  - CORS: restricted to the deployed site URL (Netlify sets URL automatically)
 */

// Only these Fantrax paths will be proxied — everything else gets a 403
const ALLOWED_PATHS = new Set([
  '/fxea/general/getStandings',
  '/fxpa/req',
  '/fxea/general/getPlayerIds',
  '/fxea/general/getTeamRosters',
])

// For the /fxpa/req endpoint, only these Fantrax API method names are permitted
const ALLOWED_FXPA_METHODS = new Set(['getStandings', 'getDraftResults'])

export default async (request) => {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/^\/fantrax/, '')

  // Block any path not on the allowlist
  if (!ALLOWED_PATHS.has(pathname)) {
    return new Response('Not allowed', { status: 403, headers: { 'Content-Type': 'text/plain' } })
  }

  // Build the Fantrax request options
  const options = { method: request.method, headers: { 'Content-Type': 'application/json' } }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bodyText = await request.text()

    // For /fxpa/req, validate the Fantrax method name inside the POST body.
    // This prevents our proxy being used as a relay to call arbitrary Fantrax methods.
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

  // Determine the CORS origin to allow.
  // Netlify automatically sets the URL env var to the site's primary domain.
  // We also allow localhost so local dev works without changes.
  const origin = request.headers.get('Origin') || ''
  const siteUrl = (typeof Netlify !== 'undefined' ? Netlify.env.get('URL') : null) || ''
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

export const config = { path: '/fantrax/*' }
