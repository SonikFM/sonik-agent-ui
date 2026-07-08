/**
 * Production guard. Framework adapters short-circuit to a no-op when this
 * returns true, so dropping `<JsonRenderDevtools />` into an app costs
 * nothing in production builds.
 *
 * Tree-shaken bundlers will fold constant `process.env.NODE_ENV` checks.
 * Consumers that run in browsers without `process` also work because the
 * typeof check guards the access.
 */
export function isProduction(): boolean {
  if (typeof process !== "undefined" && process.env) {
    return process.env.NODE_ENV === "production";
  }
  return false;
}
