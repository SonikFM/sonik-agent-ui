# Local OTel capture plan for competitor walkthrough sessions

Goal: when we run n8n, Dify, Langflow, Flowise, Activepieces, or Onyx locally for a walkthrough,
capture what their backends actually do (traces/metrics/logs) with one shared, lightweight local
stack, without editing any of their source.

## Per-tool verdict

| Tool | Native OTel? | Signals | Exact env vars | Cheapest tap if no native traces |
|---|---|---|---|---|
| **n8n** | Yes — traces | Traces only | `N8N_OTEL_ENABLED`, `N8N_OTEL_EXPORTER_OTLP_ENDPOINT`, `N8N_OTEL_EXPORTER_OTLP_TRACING_PATH`, `N8N_OTEL_EXPORTER_OTLP_HEADERS`, `N8N_OTEL_EXPORTER_SERVICE_NAME`, `N8N_OTEL_TRACES_SAMPLE_RATE`, `N8N_OTEL_TRACES_INCLUDE_NODE_SPANS`, `N8N_OTEL_TRACES_INJECT_OUTBOUND`, `N8N_OTEL_TRACES_PRODUCTION_ONLY` | n/a |
| **Dify** | Yes — traces + metrics | Traces, metrics | `ENABLE_OTEL`, `OTLP_TRACE_ENDPOINT`, `OTLP_METRIC_ENDPOINT`, `OTLP_BASE_ENDPOINT` (default `http://localhost:4318`), `OTLP_API_KEY`, `OTEL_EXPORTER_TYPE` (default `otlp`), `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc`\|`http`), `OTEL_SAMPLING_RATE` | n/a |
| **Flowise** | Metrics only | Metrics only (no trace exporter wired) | `@opentelemetry/*` packages are real deps used in `packages/server/src/metrics/OpenTelemetry.ts`, exporting via `@opentelemetry/exporter-metrics-otlp-{http,grpc,proto}` — set standard `OTEL_EXPORTER_OTLP_*` vars to redirect | Per-chatflow **Phoenix (Arize)** credential in the Analytics config on a chatflow — the only path that gets you trace-level spans for a Flowise run |
| **Langflow** | No | — | No global `OTEL_EXPORTER_OTLP_*` hook exists | Per-flow **Langfuse** tracer (`LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_HOST`/`LANGFUSE_BASE_URL`, code: `src/backend/base/langflow/services/tracing/langfuse.py`) or **LangWatch** (`LANGWATCH_API_KEY`, `LANGWATCH_ENDPOINT`, code: `.../tracing/langwatch.py`). LangSmith path sets `LANGCHAIN_TRACING_V2=true` internally. |
| **Activepieces** | Logs only (OTLP log drain, not traces) | Logs (structured "wide events" via evlog) | `AP_OTEL_ENABLED` (worker), `OTEL_ENABLED` (system prop key), drain code in `packages/server/utils/src/evlog-drains.ts` (`createOTLPDrain`) | Cheapest is **not** the OTLP drain (it only carries logs) — tail `AP_LOG_FILE` as NDJSON directly; every field is already structured wide-event JSON |
| **Onyx** | No | — | No `OTEL_` vars anywhere in backend | **Langfuse**-native: `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_HOST` (`backend/onyx/configs/app_configs.py:1547-1549`, wired in `backend/onyx/tracing/provider_config.py`) |

Two tools (n8n, Dify) speak real OTLP traces natively and can point straight at a shared collector.
Flowise gets you metrics natively but traces only through Phoenix. Langflow, Activepieces, and Onyx
have no OTLP trace path at all — for those three, the collector is not the capture point; use their
native tap instead (Langfuse container, NDJSON tail, or Phoenix), see "Non-OTel taps" below.

## Shared collector

**Choice: OTel Collector (contrib, for the OTLP receivers + file/logging exporters) + Jaeger
all-in-one for the trace UI.** Jaeger all-in-one is a single container that speaks OTLP directly
and ships a UI — the lightest option that satisfies "one docker-compose snippet, one trace UI."
Grafana Tempo needs a second container (Grafana) to view anything, so it loses on RAM and container
count for a walkthrough-only setup.

Reserved ports (already in use by one of the six tools' own compose stacks): `80, 443, 3000
(Flowise), 5001/5002/5003 (Dify), 5432 (Postgres), 5678 (n8n), 6379 (Redis), 7860 (Langflow), 8080
(Activepieces/Onyx web), 8194 (Dify sandbox)`. Checked all six repos' compose files for `4317`,
`4318`, `16686`, `13133` — none are used, so the collector stack uses OTel/Jaeger defaults
unmodified.

### docker-compose.otel.yml

```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.110.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
      - ./otel-capture:/var/log/otel-capture   # NDJSON exports land here
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "13133:13133" # health check
    depends_on:
      - jaeger

  jaeger:
    image: jaegertracing/all-in-one:1.60
    environment:
      - COLLECTOR_OTLP_ENABLED=true
    ports:
      - "16686:16686" # Jaeger UI
    # Jaeger all-in-one also accepts OTLP directly on 4317/4318, but the
    # collector fronts it here so metrics/logs can fan out separately.
```

Bring it up once (`docker compose -f docker-compose.otel.yml up -d`), then start whichever
competitor tool's own compose stack on top — they don't collide because the collector only claims
4317/4318/13133 and Jaeger only claims 16686.

### otel-collector-config.yaml

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64
  batch:
    timeout: 5s
    send_batch_size: 512

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true
  file/metrics:
    path: /var/log/otel-capture/metrics.ndjson
  file/logs:
    path: /var/log/otel-capture/logs.ndjson
  debug:
    verbosity: basic

extensions:
  health_check:
    endpoint: 0.0.0.0:13133

service:
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [file/metrics, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [file/logs, debug]
```

Traces go to Jaeger's UI (`http://localhost:16686`) for interactive viewing during the walkthrough.
Metrics and logs (Dify metrics, Activepieces log drain) land as NDJSON in `./otel-capture/` for
after-the-fact grepping — no second UI needed for a one-off session.

### RAM cost

- `otel-collector`: ~80-150 MB idle, up to ~300 MB under the `memory_limiter` cap during a burst.
- `jaeger` all-in-one (in-memory storage, default): ~200-350 MB.
- **Total: roughly 300-650 MB** for the shared stack, on top of whichever single competitor tool's
  own stack is running.

### Per-tool env blocks (paste into that tool's `.env` before `docker compose up`)

**n8n**
```
N8N_OTEL_ENABLED=true
N8N_OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
N8N_OTEL_EXPORTER_SERVICE_NAME=n8n-walkthrough
N8N_OTEL_TRACES_SAMPLE_RATE=1
N8N_OTEL_TRACES_INCLUDE_NODE_SPANS=true
```

**Dify** (`api/.env` or `docker/.env`)
```
ENABLE_OTEL=true
OTLP_BASE_ENDPOINT=http://host.docker.internal:4318
OTEL_EXPORTER_TYPE=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http
OTEL_SAMPLING_RATE=1.0
```

**Flowise** (metrics only — traces need Phoenix, see below)
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

If `host.docker.internal` isn't resolvable inside a given tool's own compose network, replace it
with the collector container's service name once both compose files share a network, or with the
host's LAN IP.

## Non-OTel taps (Langflow, Activepieces, Onyx, and Flowise traces)

These don't feed the collector above — capture them at the source instead:

- **Langflow traces** — run a local Langfuse container (`langfuse/langfuse:2`, exposes its own UI
  on 3000-range — pick an unused host port, e.g. `3001:3000`, to avoid the Flowise 3000 clash if
  both ever ran side by side) and set on Langflow's `.env`:
  ```
  LANGFUSE_PUBLIC_KEY=pk-lf-local
  LANGFUSE_SECRET_KEY=sk-lf-local
  LANGFUSE_HOST=http://host.docker.internal:3001
  ```
- **Flowise traces** — add a Phoenix (Arize) credential in the chatflow's Analytics panel in the
  UI; no env var path exists for this, it's per-chatflow.
- **Activepieces** — skip the OTLP drain (logs-only, adds a hop for no benefit); set
  `AP_LOG_FILE=/tmp/ap.ndjson` and `tail -f` it during the walkthrough — the wide-event fields are
  already structured JSON.
- **Onyx** — same Langfuse container as Langflow works; point Onyx's `.env` at it:
  ```
  LANGFUSE_SECRET_KEY=sk-lf-local
  LANGFUSE_PUBLIC_KEY=pk-lf-local
  LANGFUSE_HOST=http://host.docker.internal:3001
  ```

A single shared Langfuse container can serve both Langflow and Onyx sessions (not simultaneously,
one tool at a time per the walkthrough constraint) since both read the same three env var names.
