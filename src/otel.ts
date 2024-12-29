import { opentelemetry } from './proto'

type IExportLogsServiceRequest = opentelemetry.proto.collector.logs.v1.IExportLogsServiceRequest
type IExportTraceServiceRequest = opentelemetry.proto.collector.trace.v1.IExportTraceServiceRequest

export function decodeLogs(body: ArrayBuffer): IExportLogsServiceRequest {
  const array = new Uint8Array(body)
  return opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest.decode(array)
}

export function convert(logRequest: IExportLogsServiceRequest): IExportTraceServiceRequest | null {
  if (logRequest.resourceLogs) {
    const traceRequest = { resourceSpans: logRequest.resourceLogs.map(mapResource) }

    const invalid = opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest.verify(traceRequest)
    if (invalid) {
      throw new Error(`Invalid IExportTraceServiceRequest: ${invalid}`)
    } else {
      return traceRequest
    }
  } else {
    return null
  }
}

export function encodeTraces(request: IExportTraceServiceRequest): Uint8Array {
  return opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest.encode(request).finish()
}

type IResourceLogs = opentelemetry.proto.logs.v1.IResourceLogs
type IResourceSpans = opentelemetry.proto.trace.v1.IResourceSpans

function mapResource(logResource: IResourceLogs): IResourceSpans {
  let resource: opentelemetry.proto.resource.v1.IResource | null = null
  let scopeSpans: IScopeSpans[] | null = null

  if (logResource.resource) {
    // console.log(logResource.resource)
    const attributes = logResource.resource.attributes || []
    attributes.push({ key: 'proxy', value: { stringValue: 'logfire-logs-proxy' } })
    resource = {
      attributes,
      droppedAttributesCount: logResource.resource.droppedAttributesCount,
    }
  }

  if (logResource.scopeLogs) {
    scopeSpans = logResource.scopeLogs.map(mapScope)
  }
  return { resource, scopeSpans }
}

type IScopeLogs = opentelemetry.proto.logs.v1.IScopeLogs
type IScopeSpans = opentelemetry.proto.trace.v1.IScopeSpans

function mapScope(scopeLog: IScopeLogs): IScopeSpans {
  let { scope } = scopeLog
  let spans: ISpan[] | null = null

  if (scopeLog.logRecords) {
    spans = scopeLog.logRecords.map(mapLogRecord)
  }
  return { scope, spans }
}

type ILogRecord = opentelemetry.proto.logs.v1.ILogRecord
type ISpan = opentelemetry.proto.trace.v1.ISpan

function mapLogRecord(logRecord: ILogRecord): ISpan {
  // console.log(logRecord)
  const time = logRecord.timeUnixNano || logRecord.observedTimeUnixNano
  const attributes = logRecord.attributes || []
  attributes.push({ key: 'logfire.span_type', value: { stringValue: 'log' } })
  if (logRecord.severityNumber) {
    attributes.push({ key: 'logfire.level_num', value: { intValue: logRecord.severityNumber } })
  }
  if (logRecord.eventName) {
    attributes.push({ key: 'log_event_name', value: { stringValue: logRecord.eventName } })
  }
  if (logRecord.timeUnixNano) {
    attributes.push({ key: 'TimeUnixNano', value: { intValue: logRecord.timeUnixNano } })
  }
  if (logRecord.observedTimeUnixNano) {
    attributes.push({ key: 'ObservedTimestampUnixNano', value: { intValue: logRecord.observedTimeUnixNano } })
  }
  let name: string = 'unknown log'

  if (logRecord.body) {
    if (logRecord.body.stringValue) {
      name = logRecord.body.stringValue
    } else {
      name = JSON.stringify(logRecord.body)
      attributes.push({ key: 'log_body', value: logRecord.body })
    }
  }
  let { traceId, spanId } = logRecord
  if (!traceId || traceId.length === 0) {
    traceId = generateRand(16)
  }
  if (!spanId || spanId.length === 0) {
    spanId = generateRand(8)
  }

  return {
    traceId,
    spanId,
    startTimeUnixNano: time,
    endTimeUnixNano: time,
    attributes,
    name: truncate(name),
    droppedAttributesCount: logRecord.droppedAttributesCount,
    flags: logRecord.flags,
  }
}

/// generate a random traceID or spanID
function generateRand(bytes: number): Uint8Array {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return array
}

const MAX_LENGTH = 120

function truncate(text: string): string {
  if (text.length <= MAX_LENGTH) {
    return text
  } else {
    return text.slice(0, MAX_LENGTH) + '…'
  }
}
