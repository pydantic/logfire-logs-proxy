import { convert, encodeTraces, decodeLogs } from './otel'

export interface Env {
  GITHUB_SHA: string
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // console.log(Object.fromEntries(request.headers))
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === '/') {
      return new Response(`See https://github.com/pydantic/logfire-logs-proxy for details (commit ${env.GITHUB_SHA}.`)
    } else if (pathname !== '/v1/logs' || request.method !== 'POST') {
      return new Response('Only POST requests to `/v1/logs` are supported', { status: 404 })
    }

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
  },
} satisfies ExportedHandler<Env>

async function getBody(request: Request): Promise<ArrayBuffer> {
  if (request.body === null) {
    throw new Error('Request body is null')
  }

  const contentEncoding = (request.headers.get('Content-Encoding') || '').toLowerCase()
  if (contentEncoding === 'gzip') {
    const decompressedBodyStream = request.body.pipeThrough(new DecompressionStream('gzip'))
    return await new Response(decompressedBodyStream).arrayBuffer()
  } else if (contentEncoding) {
    throw new Error('Unsupported content encoding')
  } else {
    return await request.arrayBuffer()
  }
}
