// Test-runtime shim: Node's --experimental-strip-types resolver does not map
// TypeScript-authored `.js` ESM specifiers back to sibling `.ts` files.
// Package builds still emit dist/target-registry.js from target-registry.ts.
export * from "./target-registry.ts";
