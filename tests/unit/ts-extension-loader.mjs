import { access } from "node:fs/promises";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== "ERR_MODULE_NOT_FOUND" ||
      !context.parentURL ||
      !(specifier.startsWith(".") || specifier.startsWith("/"))
    ) {
      throw error;
    }

    const url = new URL(specifier, context.parentURL);
    if (url.pathname.endsWith(".ts")) throw error;
    const tsUrl = new URL(`${url.href}.ts`);
    try {
      await access(tsUrl);
      return { url: tsUrl.href, shortCircuit: true };
    } catch {
      throw error;
    }
  }
}
