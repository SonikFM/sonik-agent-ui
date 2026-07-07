# Overnight Demo Readiness Baseline — 2026-07-06

## Git status
## feat/analytics-hints-release-gate-20260702...origin/feat/analytics-hints-release-gate-20260702
 M apps/standalone-sveltekit/src/lib/agent-workflows/suggestions.ts
 M apps/standalone-sveltekit/src/lib/agent.ts
 M docs/handoffs/workspace-creation-tool-design-agent-handoff-2026-07-05.md
 M package.json
?? apps/standalone-sveltekit/src/lib/agent-workflows/templates.ts
?? apps/standalone-sveltekit/src/lib/tools/marketplace-workflows.ts
?? docs/handoffs/current-agent-deterministic-fix-hitlist-2026-07-06.md
?? docs/handoffs/fable5-agent-ui-operational-handoff-2026-07-06.md
?? docs/handoffs/overnight-demo-readiness-agent-handoff-2026-07-06.md
?? docs/handoffs/overnight-demo-readiness-baseline-2026-07-06.md
?? docs/handoffs/overnight-demo-readiness-ultragoal-brief-2026-07-06.md
?? docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/
?? docs/skills/
?? tests/unit/marketplace-workflow-templates.test.mjs

## Recent log
97d90ae (HEAD -> feat/analytics-hints-release-gate-20260702, origin/feat/analytics-hints-release-gate-20260702) Fix embedded agent determinism
2f9addb Harden embedded agent UI determinism
ac17f09 fix booking intake reliability
100fda4 feat: add enterprise agent ux foundation
f7f4f77 feat: add friendly tool activity projection
487c4c1 feat: add trusted intake controller actions
72c899f Wire Pipe-B evidence regressions into test gate
2b968f3 Require strong Pipe-B evidence anchors
41447c0 Reject conflicting Pipe-B log evidence
ff7e519 Accept reservation workflow skill search evidence
6f36f1b Restrict Pipe-B evidence to correlated log scope
2c4970c Anchor Pipe-B smoke evidence to generate events
754c156 Correlate booking Pipe-B smoke evidence
c913b93 Require context smoke skill search evidence
5853c3b Harden embedded booking Pipe-B smokes
b2e5f79 Stabilize embedded booking smoke sessions
300e165 Fail closed unsupported intake commits
9e2ccc7 Strip current organization scope from intake commands
befa3fd Close booking intake review hardening
5a7118d Harden booking intake execution boundary

## PR view
{"baseRefName":"codex/booking-command-copy-retrofit-20260629150347","headRefName":"feat/analytics-hints-release-gate-20260702","number":5,"state":"OPEN","title":"Open Design architecture retrofit: run lifecycle, context chips, live streaming, prompt modules, analytics + release gate","url":"https://github.com/SonikFM/sonik-agent-ui/pull/5"}

## Latest Agent UI deployments
[
  {
    "id": "e9efa3a2-0922-42b3-aec1-dd378b7fed70",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "3dea8423-4a2b-409f-975b-4ef1193ed897",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-04T16:14:21.25697Z"
  },
  {
    "id": "2ba71f1f-06d2-4f28-b328-863050598872",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "4064468b-69a8-4027-8e81-043e2d302953",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-05T21:29:37.073196Z"
  },
  {
    "id": "191731ca-5f11-41c9-b67b-33bb0f94722b",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "356b4ba9-a9b4-41af-bf66-c7aeeb1ffda7",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-05T22:28:02.000407Z"
  },
  {
    "id": "7b610cce-45b6-41e4-ac5c-81db50db72ab",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "3df1f5c0-d859-44f3-9bea-a13efb8825f9",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-05T22:30:13.008699Z"
  },
  {
    "id": "44f4baef-8210-442f-8d2a-9860e9e748af",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "196d452a-d837-4003-86eb-68f8f3e7c1ec",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-05T22:34:24.026936Z"
  },
  {
    "id": "f8171982-4216-4381-9702-fb341d40c548",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "2112afc4-29ff-408c-8957-584d650bf853",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-05T22:36:32.984475Z"
  },
  {
    "id": "3c767781-c2f2-44d1-b43b-22f0297fd260",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "115a2ec9-fe96-4940-a3fc-4eeb785fba19",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-05T22:38:46.042837Z"
  },
  {
    "id": "bef07fa9-0bbd-4855-87ff-8c0476ba91f9",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "8a20d230-303e-49dd-afff-4aa01d33eaef",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-05T23:15:39.374663Z"
  },
  {
    "id": "7d3db311-ad9b-496e-8f2a-961b19a19c71",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "991bab21-64df-43a1-8879-7524ccfb314c",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-06T00:27:41.517066Z"
  },
  {
    "id": "0ace83a0-1838-4971-9705-4ebf7dec2a67",
    "source": "wrangler",
    "strategy": "percentage",
    "author_email": "dan.letterio@sonik.fm",
    "annotations": {
      "workers/triggered_by": "deployment"
    },
    "versions": [
      {
        "version_id": "a2b50794-1628-44d5-9d7c-96c59c69c8e1",
        "percentage": 100
      }
    ],
    "created_on": "2026-07-06T07:25:28.821736Z"
  }
]

## Relevant handoff files
total 344
drwxr-xr-x@ 16 danielletterio  staff    512 Jul  6 03:43 .
drwxr-xr-x@ 15 danielletterio  staff    480 Jul  6 03:11 ..
-rw-r--r--@  1 danielletterio  staff  11403 Jul  2 02:29 agent-ui-embed-hitlist-2026-07-02.md
-rw-r--r--@  1 danielletterio  staff   6807 Jul  2 20:41 agent-ui-manual-test-run-2026-07-02.md
-rw-r--r--@  1 danielletterio  staff  11580 Jul  1 20:57 agent-ui-open-design-architecture-gap-analysis-2026-07-01.md
-rw-r--r--@  1 danielletterio  staff  12917 Jul  1 20:24 agent-ui-open-design-feature-suite-upgrade-2026-07-01.md
-rw-r--r--@  1 danielletterio  staff   4411 Jul  2 00:47 agent-ui-retrofit-execution-handoff-2026-07-02.md
-rw-r--r--@  1 danielletterio  staff  12064 Jul  2 01:06 agent-ui-retrofit-manual-testing-guide-2026-07-02.md
-rw-r--r--@  1 danielletterio  staff   6507 Jul  1 10:41 booking-service-agent-ui-host-context-fix-handoff.md
-rw-r--r--@  1 danielletterio  staff   8507 Jul  6 02:10 current-agent-deterministic-fix-hitlist-2026-07-06.md
-rw-r--r--@  1 danielletterio  staff  23018 Jul  6 01:53 fable5-agent-ui-operational-handoff-2026-07-06.md
-rw-r--r--@  1 danielletterio  staff  18359 Jul  6 03:37 overnight-demo-readiness-agent-handoff-2026-07-06.md
-rw-r--r--@  1 danielletterio  staff   6599 Jul  6 03:44 overnight-demo-readiness-baseline-2026-07-06.md
-rw-r--r--@  1 danielletterio  staff   4274 Jul  6 03:42 overnight-demo-readiness-ultragoal-brief-2026-07-06.md
-rw-r--r--@  1 danielletterio  staff  22621 Jul  5 23:21 workspace-creation-tool-design-agent-handoff-2026-07-05.md
drwxr-xr-x@ 10 danielletterio  staff    320 Jul  5 23:23 workspace-creation-tool-design-handoff-2026-07-06

## Current ultragoal goals
G001-orientation-and-evidence-baseline [in_progress] Orientation and evidence baseline
G002-booking-host-embed-readiness [pending] Booking host embed readiness
G003-agent-readable-workflow-state-actions [pending] Agent-readable workflow state and semantic actions
G004-intake-approval-ux-reliability [pending] Intake and approval UX reliability
G005-reservation-command-demo-proof [pending] Reservation and booking command demo proof
G006-ultratest-deploy-pipeb-final-report [pending] Ultratest, deploy, Pipe-B evidence, and final report gate
