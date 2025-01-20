import { convert, encodeTraces, decodeLogs } from './otel'

export interface Env {
  GITHUB_SHA: string
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // console.log(Object.fromEntries(request.headers))
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === '/') {
      return new Response(index_html(env), { headers: { 'Content-Type': 'text/html' } })
    } else if (pathname === '/v1/logs' && request.method === 'POST') {
      return await logProxy(request)
    } else if (pathname === '/v1/traces' && request.method === 'POST') {
      return await traceProxy(request)
    } else if (pathname === '/v1/traces' && request.method === 'OPTIONS') {
      return tracePreflight(request)
    } else {
      return new Response(`404: '${request.method} ${pathname}' not found`, { status: 404 })
    }
  },
} satisfies ExportedHandler<Env>

const index_html = (env: Env) => `
<h1>logfire-logs-proxy</h1>
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
  const response = await fetch('https://logfire-api.pydantic.dev/v1/traces', {
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
    return response
  } else {
    const text = await response.text()
    console.warn('Unexpected response:', { status: response.status, text })
    return new Response(text, response)
  }
}

async function traceProxy(request: Request): Promise<Response> {
  const response = await fetch('https://logfire-api.pydantic.dev/v1/traces', request)
  // add CORS headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...Object.fromEntries(response.headers),
      'Access-Control-Allow-Origin': allowOrigin(request),
    },
  })
}

const tracePreflight = (request: Request) =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin(request),
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  })

function allowOrigin(request: Request): string {
  const origin = request.headers.get('Origin')
  if (origin && origin.startsWith('http://localhost:')) {
    // allow all localhost ports
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
