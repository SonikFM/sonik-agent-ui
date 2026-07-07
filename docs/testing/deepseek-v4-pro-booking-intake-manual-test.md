# DeepSeek V4 Pro Booking Intake Manual Test Script

Last updated: 2026-07-01

## Deployment under test

Agent UI:

```txt
https://sonik-agent-ui.liam-trampota.workers.dev
```

Recommended manual test URL:

```txt
https://sonik-agent-ui.liam-trampota.workers.dev/fake-booking-host.html?autoOpen=chat&hostSession=fixture&smokeMockStream=0
```

Expected model configuration:

```txt
AI_GATEWAY_MODEL=deepseek/deepseek-v4-pro
```

The model is configured as a Cloudflare Worker secret, not a plain Wrangler var.

## Purpose

This script verifies that the embedded Sonik Agent UI can:

1. use live model inference;
2. read host/page context;
3. discover the booking context intake skill;
4. render JSON-render ask-user-question / QuestionCard style artifacts;
5. prefill a booking or event intake artifact from source copy;
6. produce a draft manifest preview; and
7. avoid mutating booking data unless explicitly approved.

## Pass criteria

A run is considered passing when:

- live inference responds without mock streaming;
- the agent knows the current host/page context;
- the agent can discover and use `booking.context.intake`;
- the agent renders a JSON artifact for intake questions;
- unknown policy/payment/capacity fields remain explicit instead of hallucinated;
- no booking write command is called before explicit approval; and
- no runtime / document / artifact 500 errors occur.

---

## Test 1 — Model sanity

Prompt:

```txt
Reply with exactly this sentence: model smoke ok.
```

Expected result:

```txt
model smoke ok.
```

Pass if:

- response is fast;
- no tool call is needed;
- no artifact opens.

Fail if:

- it says it cannot answer;
- it opens an artifact;
- it hangs or crashes.

---

## Test 2 — Page context awareness

Prompt:

```txt
Using the current page context only, tell me what booking surface I am on and what active entity is attached. Do not create an artifact.
```

Expected result:

- mentions booking / booking console / booking detail host context;
- mentions the active entity from the fake host context;
- does not create an artifact.

Fail if:

- it says it has no page context;
- it hallucinates unrelated page state;
- it creates an artifact.

---

## Test 3 — Skill discovery without artifact

Prompt:

```txt
I want to create a new booking context. First search for the right workflow skill, learn it, and tell me the skill id and the first step. Do not create an artifact yet.
```

Expected result:

- searches or uses the skill registry;
- mentions `booking.context.intake`;
- identifies the first step as choosing venue schedule / event / hybrid or inspecting source material;
- does not create an artifact yet.

Fail if:

- it jumps directly into booking writes;
- it cannot find the booking intake skill;
- it creates a real booking context.

---

## Test 4 — Ask-user QuestionCard artifact

Prompt:

```txt
Create a JSON-render booking context intake artifact using the booking.context.intake interactive surface template. Start with exactly one QuestionCard asking whether this is a venue schedule, an event, or a hybrid. Do not call booking.create.context or any booking write command.
```

Expected result:

- artifact / canvas opens;
- it shows one interactive question card;
- choices include:
  - venue schedule;
  - event;
  - hybrid;
- no booking write command is called.

Fail if:

- it only responds in plain text;
- it creates multiple duplicate artifacts;
- it calls booking write commands.

---

## Test 5 — Venue schedule path

Prompt:

```txt
Continue the intake as a venue schedule for golf tee times. Ask the next highest-impact missing question as a JSON-render QuestionCard, and keep the answer as draft artifact state only.
```

Expected result:

- asks about exactly one of:
  - schedule;
  - capacity;
  - slot duration;
  - confirmation mode;
  - payment;
  - policy;
- keeps the response as draft artifact state;
- does not mutate the booking service.

Fail if:

- it asks five questions at once;
- it writes to the booking service;
- it loses the artifact.

---

## Test 6 — Source-copy retrofit path

Prompt:

```txt
Use this source copy to prefill the intake artifact, then ask only one missing high-impact question as a QuestionCard:

"Summer Jazz Night is a private club event with dinner reservations, VIP tables, and general admission. Doors open at 6pm. Dinner starts at 7pm. VIP tables seat 6 guests. Refund policy is not finalized."
```

Expected result:

- infers event or hybrid;
- preserves refund policy as unknown / needs review;
- prefills dinner reservations, VIP tables, general admission, doors, and dinner time;
- asks one missing high-impact question.

Fail if:

- it invents a refund policy;
- it ignores the copy;
- it asks a giant static form.

---

## Test 7 — Manifest preview

Prompt:

```txt
Generate a draft manifest preview from the current intake answers. Mark unknowns explicitly and do not publish or create a real booking context.
```

Expected result:

- shows a manifest preview;
- includes missing fields, readiness, and warnings;
- unknowns are explicit;
- does not call `booking.create.context`.

Fail if:

- it publishes;
- it hides unknowns;
- it creates a booking context without approval.

---

## Test 8 — Write-boundary check

Prompt:

```txt
Before creating anything in the booking service, tell me what fields are still missing and what command would be used later if I explicitly approve publishing.
```

Expected result:

- no write occurs;
- names missing fields;
- mentions the future publish/create command only as a later step.

Fail if:

- it mutates booking data;
- it says everything is ready when required fields are missing.

---

## Test 9 — Optional approved publish test

Only run this if real write attempts are acceptable.

Prompt:

```txt
I approve creating a draft booking context only if all required fields are present. If anything is missing, ask me one QuestionCard instead of writing.
```

Expected result:

- if required fields are missing, asks one QuestionCard;
- if complete, learns and uses the correct booking create command with typed input.

Fail if:

- it writes despite missing required fields;
- it uses unrelated reservation or hold commands.

---

## Critical fail signals

Stop the run and collect logs if any of these appear:

```txt
Workspace cloud runtime is not available
missing-host-context
POST /api/document failed with 500
Create artifact failed
runtime_unavailable
Missing path parameter
requires a JSON request body
```

## Highest-value smoke path

If time is limited, run only:

1. Test 2 — Page context awareness
2. Test 4 — Ask-user QuestionCard artifact
3. Test 6 — Source-copy retrofit path
4. Test 7 — Manifest preview

This proves the core v0.2 intake thesis: host context + skill discovery + JSON-render intake artifact + manifest preview without premature booking mutation.
