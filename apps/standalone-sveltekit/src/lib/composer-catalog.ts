export type ComposerCatalogResult<T> =
  | { status: "ready"; value: T }
  | { status: "unavailable" };

export async function fetchComposerCatalog<T>(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
): Promise<ComposerCatalogResult<T>> {
  try {
    const response = await fetcher(input);
    if (!response.ok) return { status: "unavailable" };
    return { status: "ready", value: await response.json() as T };
  } catch {
    return { status: "unavailable" };
  }
}
