// Proxy all /fantrax/* requests to www.fantrax.com, preserving method, headers, and body.
// Netlify's [[redirects]] proxy drops POST bodies — this edge function handles them correctly.

const ALLOWED_PATHS = new Set([
  '/fxea/general/getStandings',
  '/fxpa/req',
  '/fxea/general/getPlayerIds',
  '/fxea/general/getTeamRosters',
])

export default async (request) => {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/^\/fantrax/, '')

  if (!ALLOWED_PATHS.has(pathname)) {
    return new Response('Not allowed', { status: 403, headers: { 'Content-Type': 'text/plain' } })
  }

  const fantraxUrl = `https://www.fantrax.com${pathname}${url.search}`

  const options = { method: request.method, headers: { 'Content-Type': 'application/json' } }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    options.body = await request.text()
  }

  // Restrict CORS to the deployed site; allow localhost for local dev.
  // Netlify automatically sets the URL env var to the site's primary URL.
  const origin = request.headers.get('Origin') || ''
  const siteUrl = (typeof Netlify !== 'undefined' ? Netlify.env.get('URL') : null) || ''
  const allowOrigin = (siteUrl && origin === siteUrl) || origin.startsWith('http://localhost') ? origin : siteUrl || '*'

  try {
    const res = await fetch(fantraxUrl, options)
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowOrigin }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowOrigin }
    })
  }
}

export const config = { path: '/fantrax/*' }
