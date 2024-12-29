# logfire-logs-proxy

Proxy for sending OTel logs to [Logfire](https://pydantic.dev/logfire).

Run as a CloudFlare Worker.

## Usage

Set your OTel logs endpoint to `https://logfire-logs-proxy.pydantic.workers.dev/v1/logs`.

Add the `Authorization` header are your [normally would with Logfire](https://logfire.pydantic.dev/docs/how-to-guides/alternative-clients/).

With that OTel logs should appear in logfire as traces.
