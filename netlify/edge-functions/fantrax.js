// Proxy all /fantrax/* requests to www.fantrax.com, preserving method, headers, and body.
// Netlify's [[redirects]] proxy drops POST bodies — this edge function handles them correctly.
export default async (request) => {
  const url = new URL(request.url)
  const fantraxUrl = `https://www.fantrax.com${url.pathname.replace(/^\/fantrax/, '')}${url.search}`

  const options = { method: request.method, headers: { 'Content-Type': 'application/json' } }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    options.body = await request.text()
  }

  try {
    const res = await fetch(fantraxUrl, options)
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: { 'Content-Type': 'application/json' } })
  }
}

export const config = { path: '/fantrax/*' }
