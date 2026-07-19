# Ultragoal UI evidence — 2026-07-14

These screenshots are local deterministic Playwright fixtures. They contain no production data and are not evidence of a production deployment.

| Goal | Viewport and scenario | Evidence |
| --- | --- | --- |
| G018 | 1100px composer after one-retry authority recovery; the uploaded file remains staged | ![G018 wide recovered composer](g018-file-authority/composer-1100.png) |
| G018 | 360px composer after one-retry authority recovery; the uploaded file remains staged | ![G018 mobile recovered composer](g018-file-authority/composer-360.png) |
| G018 | 1100px permanent upload refusal with sanitized copy and native Retry/Remove actions | ![G018 wide failed upload state](g018-file-authority/failed-upload-1100.png) |
| G018 | 360px permanent upload refusal with sanitized copy and native Retry/Remove actions | ![G018 mobile failed upload state](g018-file-authority/failed-upload-360.png) |
| G019 | 1100px canvas mode with hidden history rail; persisted history remains visible at the authority-recovery checkpoint | ![G019 wide hidden-rail authority recovery](g019-session-history/canvas-hidden-1100-authority-recovery.png) |
| G019 | 390px canvas mode with hidden history rail; persisted history remains visible at the authority-recovery checkpoint | ![G019 mobile hidden-rail authority recovery](g019-session-history/canvas-hidden-390-authority-recovery.png) |
| G019 | 1100px full workspace with expanded history rail; the selected chat is preserved and Retry is available | ![G019 wide expanded-workspace authority recovery](g019-session-history/workspace-expanded-1100-authority-recovery.png) |
| G019 | 390px full workspace with expanded history rail; the selected chat is preserved and Retry is available | ![G019 mobile expanded-workspace authority recovery](g019-session-history/workspace-expanded-390-authority-recovery.png) |

## Reproduction

- G018 source: [`tests/e2e/file-upload-authority-recovery.spec.ts`](../../../tests/e2e/file-upload-authority-recovery.spec.ts)
- G019 source: [`tests/e2e/embedded-session-history.spec.ts`](../../../tests/e2e/embedded-session-history.spec.ts)

```sh
pnpm exec playwright test -c tests/e2e/playwright.config.ts \
  tests/e2e/file-upload-authority-recovery.spec.ts \
  tests/e2e/embedded-session-history.spec.ts \
  --workers=1
```

Result: **7/7 tests passed** using local deterministic route and host-authority fixtures.
