# Manual Test Run — Agent UI Embed (post Wave 1 + intake routing fix)

Date: 2026-07-02
Tester: agent (browser-driving) or human
Where: the embedded Sonik Chat sidecar inside the booking app (the same place all prior bugs were found). Standalone mode only where noted.
Branch under test: `feat/analytics-hints-release-gate-20260702` at `173d07d` or later.

## Step 0 — Confirm you're testing the right deploy

Before anything: verify the deployed Worker includes commit `173d07d` ("route submitAnswer params to the pointer QuestionCard binds"). If the last deploy predates it, redeploy first:

```bash
pnpm --filter svelte-chat build && cd apps/standalone-sveltekit && pnpm exec wrangler deploy
```

If you test a stale deploy, every intake result below is invalid. This has burned us twice — check first.

## How to test

Talk to the chat like a normal person. Use the exact sentences below (or natural variations). Do NOT use prompt-engineering phrasing, format directives, or spec jargon — the whole point is to see what a regular operator gets. One exception: the first prompt is a capability showcase and can stay fancy.

After each step, record: step number, PASS/FAIL, screenshot if FAIL, and one sentence on what you saw.

---

## Part A — The showcase (the one fancy prompt)

1. Type: **"Create an artifact that shows me what you're capable of."**
   - PASS: an artifact appears on the canvas and builds progressively while it generates (components appear before it finishes).
2. When it's done, click any buttons inside the artifact (Show/Hide, counters, tabs).
   - PASS: they respond. This is the H1 fix — canvas artifact buttons were dead before.

## Part B — Venue intake, the flow that's been broken twice (plain sentences only)

3. Start over (Start Over button), then type: **"I want to set up my venue for bookings."**
   - PASS: the agent starts the intake and a question card appears on the canvas asking what you're configuring.
4. Click **Venue schedule** on the card. Then click **Continue**.
   - PASS: no red error text appears; the draft manifest's `intakeMode` changes from "unknown" to your choice; the agent responds on its own with the next question — you should not have to type anything.
   - FAIL looked like (old bug): red "answer_required / invalid_choice" text and nothing happening. If you see that, capture it and stop Part B.
5. Answer the next two or three questions the same way — click an option, press Continue. Where a question wants text, type a short normal answer like **"The Main Course tee sheet, 18 holes."**
   - PASS: each answer sticks, the draft manifest fills in, and the next question arrives without typing in chat.
6. Try **Mark unknown** (skip) on one question.
   - PASS: it moves on and records the field as unknown rather than blocking.
7. Type: **"How is the setup looking so far?"**
   - PASS: the agent summarizes the draft manifest state accurately (fields answered vs unknown).

## Part C — Interruptions and recovery

8. Type: **"Tell me everything I should know about running tee time bookings."** While it's answering, press **Stop**.
   - PASS: a Continue option appears right there without reloading.
9. Click **Continue**.
   - PASS: it picks up and finishes; the conversation shows one answer for that turn, not two.
10. Ask another long question, and this time reload the page mid-answer.
    - PASS: after reload, the partial answer is still there with a way to continue it. No duplicate bubbles.

## Part D — Context chips and pages

11. Look at the chips above the message box (e.g. "Operations Home", "Main Course Tee Sheet"). Remove one with its ×, then send: **"What can you see about this page right now?"**
    - PASS: the removed chip stays removed and the agent's answer no longer references it; the remaining chip is reflected accurately.
12. Navigate to a different booking page in the host app, then come back.
    - KNOWN ISSUE (do not file): the chat may disappear or lose state on host navigation — that's Wave 2 item H5. Note what happens but it's expected.
13. Check the left session rail.
    - PASS: conversations show short readable titles, not single letters. (Old conversations from before the fix may still be letters — only judge new ones.)

## Part E — Small checks

14. Ask: **"Show me a chart of monthly visitors for the last six months."**
    - PASS: months on the x-axis are in calendar order.
15. In chat (not the canvas), the agent's inline cards/charts should render normally — this has been working; just confirm nothing regressed.

---

## Part F — Theme investigation (LOOK, DO NOT TOUCH)

Context: "theme sharing" shipped in Wave 1 (H7 — embedded chat derives its theme from the host instead of its own picker). The result is wrong in a way that matters: **both surfaces are neumorphic-light, but the booking page renders clean white/gray while the chat sidecar renders a muddy tan/rose tint** (see screenshot from 2026-07-02 20:37 — the chat looks like a different product).

Your job is investigation ONLY. A theming overhaul is planned; nothing here should be fixed, styled, or patched. Produce a findings note answering:

1. **What theme value does the host actually send?** Inspect the embed handshake / host context (browser devtools: the iframe URL params, postMessage payloads, or the signed host context) and record the exact theme string/tokens transmitted.
2. **What does the embed resolve it to?** In the embed, check which theme the runtime applied (`theme-runtime` resolution: host theme > stored pref > default) — did it apply the host's value, fall back to a stored "Gunmetal Light" preference from earlier testing, or map the host's name onto a different token set?
3. **Where do the palettes diverge?** Compare computed background/surface colors (devtools computed styles) on the booking page vs the chat surface. Identify whether the tan tint comes from a theme token set, a color-mix/overlay on the chat container, or a wrong DaisyUI/theme-registry entry.
4. **Is the picker actually hidden in embedded mode?** (It should be, per H7.)
5. Write it up in `docs/reviews/theme-sharing-findings-2026-07-02.md`: sent value → resolved value → token diffs → root-cause hypothesis. That doc feeds the theming overhaul; do not change any code or styles.

---

## Reporting

File one summary at the end: table of steps 1–15 with PASS/FAIL, screenshots for fails, plus the Part F findings doc path. Anything that fails in Part B is highest priority — report it immediately rather than waiting for the end of the run.

Known-broken, don't report (Wave 2 backlog): chat lost on host navigation (H5), slow chat switching (H6), header text collision / no canvas drag-resize / nested boxes / dev tabs visible (H9), no file attachments (H11).
