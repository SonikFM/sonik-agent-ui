import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const contracts = read("apps/dev-workbench/src/lib/contracts/workbench.ts");
const bootstrap = read("apps/dev-workbench/src/lib/server/bootstrap-plan.ts");
const workspace = read("apps/dev-workbench/src/lib/server/workspace-service.ts");
const sandbox = read("apps/dev-workbench/src/lib/server/vercel-sandbox.ts");

assert.doesNotMatch(contracts, /hostAuthority:\s*z\.literal|hostAuthority:\s*`/, "guest mirror paths exclude host authority");
assert.doesNotMatch(bootstrap, /SONIK_HOST_AUTHORITY_PATH|DEV_WORKBENCH_CLOUDFLARE_API_TOKEN/, "tmux exposes neither authority nor control-plane credential instructions");
assert.doesNotMatch(workspace, /DEV_WORKBENCH_MIRROR_PATHS\.hostAuthority|host-authority\.json|function sandboxEnvironment/, "workspace provisioning never writes guest authority or constructs a credential environment");
assert.doesNotMatch(sandbox, /env\?:\s*Record<string, string>|input\.env/, "Sandbox.create has no generic environment passthrough");

console.log("dev-workbench runtime security contract: ok");
