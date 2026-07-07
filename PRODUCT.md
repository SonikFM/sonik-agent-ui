# Sonik Agent UI Product Context

## Product promise

Sonik Agent UI is an embeddable, page-aware agent workspace for Sonik and partner applications. It lets an authenticated host application donate page context, signed command grants, and theme hints while the agent renders chat, structured JSON artifacts, documents, and workflow controls inside a reusable sidecar/canvas shell.

## Primary users

- **Operators** using Sonik Booking or Amplify who need natural-language workflow help without leaving the current page.
- **Implementation teams** configuring bookable venues, events, campaigns, and command manifests.
- **Developers / platform teams** embedding the agent UI through the Sonik SDK and verifying command, session, artifact, and telemetry contracts.

## Core surfaces

- **Embedded sidecar:** compact page-aware chat that compresses host layout and inherits host session/context.
- **Canvas modal:** larger workspace for JSON-render artifacts, documents, intake forms, dashboards, and workflow previews.
- **Standalone harness:** local/cloud test surface for agent UI development when no host page is present.
- **Agent controls:** settings/control plane for model choice, runtime skills, custom session skills, tool permissions, context, and future MCP add-ons.

## Non-negotiable boundaries

- Host session and signed host context are authoritative for cloud runtime and mutating commands.
- Tool permission controls can lower friction but must not bypass host approval, RLS, org/user scope, or command preflight.
- Model selection is dynamic through Vercel AI Gateway where available; fallback models are only a resilience path.
- Zero-data-retention is an enforcement requirement at Gateway/request policy, not a cosmetic model-list badge unless the catalog exposes verified metadata.
- Custom Markdown skills are session context unless explicitly published through Sonik skills infrastructure.

## Experience principles

1. **Workflow-first:** surface “set up venue,” “create reservation,” “create event,” and “campaign template” workflows before generic toy prompts.
2. **Explain trust:** every mutating command should make permission state, host context, and receipt/audit behavior legible.
3. **Progressive disclosure:** show enough controls for experts without making basic operators configure agents before working.
4. **Enterprise clarity:** labels, empty states, disabled reasons, and telemetry must explain what is available, unavailable, or host-gated.
5. **Copy/retrofit friendly:** design and command seams should be portable into Booking, Amplify, and future Sonik SDK hosts without duplicating product logic.

## Current v0.2 focus

- Dynamic model picker with Gateway-backed discovery.
- ZDR-required runtime setting that reflects real enforcement rather than assumed catalog metadata.
- Runtime skill picker plus temporary Markdown skill drafting.
- Tool family permission controls using Off / Ask / Allow semantics.
- Editable additional system prompt for session-level agent steering.
- Honest MCP add-ons placeholder for future connector install/authorization work.

## Known follow-ons

- Rich text skill/document editing using Sonik editor patterns.
- Agent/profile creation and saved presets.
- Verified ZDR/provider compliance registry if Vercel Gateway exposes or Sonik curates provider metadata.
- Fine-grained tool permissions at command level, not only family level.
- MCP add-on registry with OAuth/session scopes and host-managed grants.
