// Test-runtime shim: Node's --experimental-strip-types resolver does not map
// TypeScript-authored `.js` ESM specifiers back to sibling `.ts` files.
// Package builds still emit dist/visual-context.js from visual-context.ts.
export * from "./visual-context.ts";
