import { convert, encodeTraces, decodeLogs } from './otel'

export interface Env {
  GITHUB_SHA: string
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // console.log(Object.fromEntries(request.headers))
    const { pathname } = new URL(request.url)
    if (pathname === '/') {
      if (request.method === 'GET') {
        return new Response(index_html(env), { headers: { 'Content-Type': 'text/html' } })
      } else {
        return wrongMethod(request, 'GET')
      }
    } else if (pathname === '/v1/logs') {
      if (request.method === 'POST') {
        return await logProxy(request)
      } else {
        return wrongMethod(request, 'POST')
      }
    } else if (pathname.startsWith('/v1/')) {
      if (request.method === 'OPTIONS') {
        return preflight(request)
      } else {
        return await pureProxy(request, pathname)
      }
    } else {
      return new Response(`404: '${request.method} ${pathname}' not found`, { status: 404 })
    }
  },
} satisfies ExportedHandler<Env>

const msg = 'This proxy service will soon be switched off, please use the standard endpoints'
const index_html = (env: Env) => `
<h1>logfire-logs-proxy</h1>
${msg}
<p>
  See <a href="https://github.com/pydantic/logfire-logs-proxy">github.com/pydantic/logfire-logs-proxy</a>
  for details (commit <code>${env.GITHUB_SHA}</code>).
</p>
`

async function logProxy(request: Request): Promise<Response> {
  const auth = request.headers.get('Authorization')
  if (!auth) {
    return new Response('No "Authorization" header', { status: 401 })
  }

  let body: ArrayBuffer
  try {
    body = await getBody(request)
  } catch (e) {
    console.log('Error parsing request body:', e)
    return new Response(`Error collecting request body: ${e}`, { status: 400 })
  }

  let logRequest
  try {
    logRequest = decodeLogs(body)
  } catch (e) {
    console.log('Error parsing protobuf:', e)
    return new Response(`Error parsing protobuf: ${e}`, { status: 400 })
  }

  const traceRequest = convert(logRequest)
  if (!traceRequest || !traceRequest.resourceSpans) {
    return new Response('no data to proxy', { status: 202 })
  }

  console.log('Sending trace to logfire')
  // console.log('Sending trace to logfire', JSON.stringify(traceRequest.resourceSpans, null, 2))
  const response = await fetch(`${getBaseUrlFromToken(request)}/v1/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-protobuf',
      Authorization: auth,
      'User-Agent': `logfire-logs-proxy ${request.headers.get('User-Agent')}`,
    },
    body: encodeTraces(traceRequest),
  })
  if (response.ok) {
    console.log('Successfully sent trace to logfire')
    return new Response(msg, { status: 410 })
  } else {
    const text = await response.text()
    console.warn('Unexpected response:', { status: response.status, text })
    return new Response(text, response)
  }
}

async function pureProxy(request: Request, pathname: string): Promise<Response> {
  const response = await fetch(`${getBaseUrlFromToken(request)}${pathname}`, request)
  const headers = new Headers(response.headers)
  if (!headers.has('Access-Control-Allow-Origin')) {
    headers.set('Access-Control-Allow-Origin', allowOrigin(request))
  }
  return new Response(msg, { status: 410 })
}

const preflight = (request: Request) =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin(request),
      'Access-Control-Allow-Methods': 'POST',
      // allow all the headers requested
      'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') || '',
    },
  })

function allowOrigin(request: Request): string {
  const origin = request.headers.get('Origin')
  if (origin && origin.startsWith('http://localhost:')) {
    // allow all localhost ports
    return origin
  } else if (origin && origin.endsWith('.pydantic.workers.dev')) {
    // allow all pydantic.workers.dev subdomains
    return origin
  } else {
    // otherwise do the simple thing and allow just https://pydantic.run
    return 'https://pydantic.run'
  }
}

async function getBody(request: Request): Promise<ArrayBuffer> {
  if (request.body === null) {
    throw new Error('Request body is null')
  }

  const contentEncoding = (request.headers.get('Content-Encoding') || '').toLowerCase()
  let body = request.body
  if (contentEncoding === 'gzip' || contentEncoding === 'deflate') {
    body = body.pipeThrough(new DecompressionStream(contentEncoding))
  } else if (contentEncoding) {
    throw new Error(`Unsupported content encoding "${contentEncoding}"`)
  }
  return await new Response(body).arrayBuffer()
}

function wrongMethod(request: Request, allow: string): Response {
  const msg = `405: '${request.method} ${request.url}' method not allowed

Expected ${allow} request, see https://github.com/pydantic/logfire-logs-proxy for details`
  return new Response(msg, {
    status: 405,
    headers: { allow },
  })
}

const TOKEN_PATTERN = /^pylf_v[0-9]+_([a-z]+)_[a-zA-Z0-9]+$/

function getBaseUrlFromToken(request: Request): string {
  let token = request.headers.get('Authorization') || ''
  token = token.replace(/^Bearer /, '')
  const match = token.match(TOKEN_PATTERN)
  const region = match ? match[1] : 'us'
  return `https://logfire-${region}.pydantic.dev`
}
