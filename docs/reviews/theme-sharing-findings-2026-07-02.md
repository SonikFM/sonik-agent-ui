# Theme sharing findings — 2026-07-02

Run: `theme-findings-post-wave1-20260702222131`

## 1. Sent host theme value

Host context endpoint theme: `null/not-present`. Host page-context/theme payload:

```json
{
  "active": "gunmetal-dark",
  "persisted": "gunmetal-dark"
}
```

## 2. Embed resolved theme

```json
{
  "iframeUrl": "https://sonik-agent-ui.liam-trampota.workers.dev/?agentUiHostOrigin=https%3A%2F%[signed-token]&theme=gunmetal-dark&embedMode=chat&rail=hidden&smokeMockStream=0&smokeRunId=theme-findings-post-wave1-20260702222131",
  "htmlAttrs": {
    "className": "",
    "theme": "gunmetal-dark"
  },
  "pageContextTheme": "gunmetal-dark",
  "themePickerVisible": false
}
```

## 3. Palette divergence

Host computed surfaces:

```json
[
  {
    "selector": "body",
    "bg": "rgba(0, 0, 0, 0)",
    "color": "rgb(229, 233, 239)",
    "border": "rgb(229, 233, 239)",
    "className": ""
  },
  {
    "selector": "main",
    "bg": "rgba(0, 0, 0, 0)",
    "color": "rgb(229, 233, 239)",
    "border": "rgb(229, 233, 239)",
    "className": "flex-1 space-y-6 p-5"
  },
  {
    "selector": ".bg-base-100",
    "bg": "rgb(26, 29, 33)",
    "color": "rgb(229, 233, 239)",
    "border": "rgb(46, 52, 62)",
    "className": "menu dropdown-content z-50 mt-3 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-xl"
  },
  {
    "selector": ".card",
    "bg": "rgba(0, 0, 0, 0)",
    "color": "rgb(229, 233, 239)",
    "border": "rgb(229, 233, 239)",
    "className": "card card-border"
  }
]
```

Embed computed surfaces:

```json
[
  {
    "selector": "body",
    "bg": "rgb(26, 29, 33)",
    "color": "rgb(229, 233, 239)",
    "border": "rgb(46, 52, 62)",
    "className": ""
  },
  {
    "selector": "[data-theme]",
    "bg": "rgb(26, 29, 33)",
    "color": "rgb(229, 233, 239)",
    "border": "rgb(46, 52, 62)",
    "className": ""
  }
]
```

## 4. Picker hidden in embedded mode

Observed picker/theme-control visibility: `not visible by text/control scan`.

## 5. Root-cause hypothesis

The host endpoint does not send an explicit `hostSession.theme` value, but the iframe URL includes the host page theme via query params and the embedded page context resolves to the value shown above. Any muddy/tan/rose divergence is likely from Agent UI's own theme token mapping/container overlays rather than a missing authenticated host context. This doc is read-only evidence; no styling code was changed.
