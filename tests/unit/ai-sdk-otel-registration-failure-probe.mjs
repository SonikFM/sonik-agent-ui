import { registerHooks } from "node:module";

const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "ai") {
      return stub(`export function registerTelemetry(){globalThis.__registrationCalls=(globalThis.__registrationCalls??0)+1;throw new Error("PRIVATE_BOOT_FAILURE")}`);
    }
    if (specifier === "@ai-sdk/otel") return stub("export class OpenTelemetry { constructor(options){ this.options = options } }");
    if (specifier === "./agent-telemetry.ts" && context.parentURL?.includes("/ai-sdk-telemetry.ts")) {
      return stub("export function emitAgentTelemetrySync(){}");
    }
    return nextResolve(specifier, context);
  },
});

const { registerAiSdkTelemetry } = await import("../../apps/standalone-sveltekit/src/lib/server/ai-sdk-telemetry.ts");
const first = registerAiSdkTelemetry();
const second = registerAiSdkTelemetry();
process.stdout.write(`${JSON.stringify({ first, second, calls: globalThis.__registrationCalls ?? 0 })}\n`);
