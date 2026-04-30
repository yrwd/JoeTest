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
      return handleFantrax(request, env, url)
    }

    return env.ASSETS.fetch(request)
  },
}

async function handleFantrax(request, env, url) {
  const pathname = url.pathname.replace(/^\/fantrax/, '')

  if (!ALLOWED_PATHS.has(pathname)) {
    return new Response('Not allowed', { status: 403, headers: { 'Content-Type': 'text/plain' } })
  }

  const options = {
    method: request.method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
      'Accept-Language': request.headers.get('Accept-Language') || 'en-US,en;q=0.9',
    },
  }

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
  const allowOrigin =
    (siteUrl && origin === siteUrl) || origin.startsWith('http://localhost')
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
