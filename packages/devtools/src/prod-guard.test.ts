import { afterEach, describe, expect, it } from "vitest";
import { isProduction } from "./prod-guard";

describe("isProduction", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("returns false when NODE_ENV is not production", () => {
    process.env.NODE_ENV = "test";
    expect(isProduction()).toBe(false);
  });

  it("returns true when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    expect(isProduction()).toBe(true);
  });

  it("returns false when NODE_ENV is undefined", () => {
    delete process.env.NODE_ENV;
    expect(isProduction()).toBe(false);
  });
});
