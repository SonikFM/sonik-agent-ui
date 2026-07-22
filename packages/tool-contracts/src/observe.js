// Test-runtime shim: Node's --experimental-strip-types resolver does not map
// TypeScript-authored `.js` ESM specifiers back to sibling `.ts` files.
// Package builds still emit dist/observe.js from observe.ts.
export * from "./observe.ts";
