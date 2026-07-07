# Sonik Agent UI — Embedded Agent Experience PRD

Version: 1.0 · Date: 2026-07-06 · Owner: Dan Letterio · Status: ACTIVE
Scope: the embedded agent sidecar product — agent on-screen control, demo-ready UX, and the programmatic testing harness. The agent marketplace is a related-but-parked program (see §9).

---

## 1. Product thesis

An agent embedded in a host application should be able to **see** the page (machine-readable state), **act** on it (typed semantic actions), **build** UI of its own (execution-inert generated surfaces), and **prove** what it did (correlated evidence) — without ever holding write authority the host didn't sign. When the harness enforces all four, the intelligence of the underlying model becomes a cost knob, not a safety boundary: a cheaper model on a world-class harness beats an expensive model on a loose one.

This is the differentiating bet. Most agent-UI products (surveyed 2026-07-06: CopilotKit/AG-UI, assistant-ui, Tambo, OpenAI Apps SDK, A2UI) give agents chat plus generated components; none pair it with a queryable page-state contract, typed refusals, and an evidence doctrine. Sonik's `getPageContext()`/`getAssertions()` surface is ahead of the field; this PRD is the pl