// Test-runtime shim: Node's --experimental-strip-types resolver does not map
// TypeScript-authored `.js` ESM specifiers back to sibling `.ts` files.
// Package builds still emit dist/capability-matrix.js from capability-matrix.ts.
export * from "./capability-matrix.ts";
