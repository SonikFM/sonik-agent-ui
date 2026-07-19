import assert from "node:assert/strict";
import {
  PLAYWRIGHT_SMOKE_IMAGE,
  SANDBOX_WORKSPACE,
  sandboxSmokeDockerArgs,
} from "../../scripts/agent-ui-visual-context-sandbox-runner.mjs";

const args = sandboxSmokeDockerArgs("/repo with spaces");
assert.deepEqual(args.slice(0, 6), ["run", "--rm", "--ipc=host", "-v", "/repo with spaces:/src:ro", PLAYWRIGHT_SMOKE_IMAGE]);
const script = args.at(-1);
assert.match(script, new RegExp(`cd ${SANDBOX_WORKSPACE}`));
assert.match(script, /pnpm smoke:agent-ui:visual-context:sandbox:internal/);
assert.doesNotMatch(script, /pnpm smoke:agent-ui:visual-context:sandbox(?:\s|$)/, "the container never recursively invokes the public wrapper");
assert.match(script, /--exclude=node_modules/);
assert.match(script, /pnpm install --frozen-lockfile/);

console.log("visual context sandbox smoke runner: ok");
