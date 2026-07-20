# G005 Pipe B bounded API reliability evidence

- Target: `GET https://sonik-booking-service-pipe-b.liam-trampota.workers.dev/api/v1/booking/ping`
- Environment: staging
- Bounds: read-only GET; 5 VUs; 30 seconds; no credentials, writes, fuzzing, production, or Agent UI traffic
- Stop condition: first unexpected 5xx (harness abort); threshold `unexpected_5xx rate==0`

## Baseline

- HTTP 200
- Total: 468.921 ms; connect: 82.515 ms; time to first byte: 468.625 ms
- Body reported `service=sonik-booking-service`, `ok=true`, `sessionMode=demo-harness`, `demoAuth=true`, and `venueProductionReady=false`

## Load

- Exit: 0
- Requests/iterations: 145 / 145; 4.6854 req/s
- Checks: 145/145 (100%)
- Functional success: 145/145 (100%; threshold >99% passed)
- Unexpected 5xx: 0/145 (0%; threshold 0% passed)
- HTTP request failures: 0/145 (0%)
- Latency: avg 53.468 ms; min 17.266 ms; median 37.836 ms; max 463.051 ms; p90 75.315 ms; p95 113.947 ms

## Post-load recovery probe

- HTTP 200
- Total: 447.590 ms; connect: 28.089 ms; time to first byte: 447.228 ms
- Body again reported `ok=true` and `sessionMode=demo-harness`

## Caveats

- This endpoint proves bounded liveness/availability only. A single post-load health GET is not sustained recovery or downstream workflow proof because no `PROOF_URL` was authorized.
- Static schema drift is present: the checked-in OpenAPI fixture declares `additionalProperties: false`, but staging returned `membershipRole` and `organizationId`. The same fixture says anonymous callers receive `authenticated: false`; this credential-free request instead resolved the staging demo harness (`authenticated: true`, `demoAuth: true`). No mutation or scope widening was performed.
- Generated runtime bindings currently apply auth-required/org-scoped posture to every command even though the ping OpenAPI operation declares `security: []`; this was recorded only as a caveat.

## Raw evidence

- `g005-pipe-b-api-reliability-20260720-baseline.{headers,body.json,timing.json}`
- `g005-pipe-b-api-reliability-20260720-k6-{output.txt,summary.json,exit.txt}`
- `g005-pipe-b-api-reliability-20260720-recovery.{headers,body.json,timing.json}`
