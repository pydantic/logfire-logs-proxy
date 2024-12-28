# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "opentelemetry-exporter-otlp-proto-http",
#     "opentelemetry-sdk",
# ]
# ///

"""Python code to generate OTel logs.

Adapted from
https://github.com/open-telemetry/opentelemetry-python/blob/main/docs/examples/logs/example.py
"""
import os
import logging

from opentelemetry import trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider

trace.set_tracer_provider(TracerProvider())

logger_provider = LoggerProvider(
    resource=Resource.create(
        {
            'service.name': 'testing-service',
            'service.instance.id': 'instance-12',
        }
    ),
)
set_logger_provider(logger_provider)

LOGFIRE_TOKEN = os.environ['LOGFIRE_TOKEN']
exporter = OTLPLogExporter(
    endpoint='http://localhost:8787/v1/logs',
    headers={'Authorization': f'Bearer {LOGFIRE_TOKEN}'}
)
logger_provider.add_log_record_processor(BatchLogRecordProcessor(exporter))
handler = LoggingHandler(level=logging.DEBUG, logger_provider=logger_provider)

logging.basicConfig(level=logging.DEBUG, handlers=[handler], format='%(message)s')

logger1 = logging.getLogger('myapp.area1')
logger2 = logging.getLogger('myapp.area2')

logger1.debug('debug %d', 41)
logger1.info('info %d', 42)
logger1.warning('warning %d', 43)
logger1.error('error %d', 44)


# Trace context correlation
tracer = trace.get_tracer(__name__)
with tracer.start_as_current_span('foo'):
    logger2.warning('nested span %d', 42)

logger_provider.shutdown()
