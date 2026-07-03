import assert from "node:assert/strict";
import {
  DEFAULT_DOCUMENT_THEME_ID,
  resolveEmbeddedThemeSetting,
} from "../../apps/standalone-sveltekit/src/lib/theme/theme-runtime.ts";

assert.equal(
  resolveEmbeddedThemeSetting({ hostTheme: "sonik-operator-dark", storedSetting: "gunmetal-light" }),
  "sonik-operator-dark",
  "embedded theme resolution should prefer the Booking host operator theme over the stored preference",
);

assert.equal(
  resolveEmbeddedThemeSetting({ hostTheme: "unknown-theme", storedSetting: "gunmetal-light" }),
  "gunmetal-light",
  "embedded theme resolution should fall back to stored preference when the host theme is invalid",
);

assert.equal(
  resolveEmbeddedThemeSetting({ hostTheme: null, storedSetting: null }),
  "sonik-operator-dark",
  "embedded theme resolution should fall back to the operator theme without host or stored preferences",
);
