// Test-runtime shim: Node's --experimental-strip-types resolver does not map
// TypeScript-authored `.js` ESM specifiers back to sibling `.ts` files.
// Package builds still emit dist/knowledge-ref.js from knowledge-ref.ts.
export * from "./knowledge-ref.ts";
