#!/usr/bin/env bash

set -e
set -x

mkdir -p src/proto

npx pbjs -t static-module -w commonjs \
  -o src/proto/index.js \
  -p opentelemetry-proto \
  opentelemetry-proto/opentelemetry/proto/collector/trace/v1/trace_service.proto \
  opentelemetry-proto/opentelemetry/proto/collector/logs/v1/logs_service.proto

npx pbts -o src/proto/index.d.ts src/proto/index.js
