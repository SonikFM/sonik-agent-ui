import type { RequestEvent } from "@sveltejs/kit";

export function createServiceBindingFetcher(binding: unknown): typeof fetch | undefined {
  if (!binding || typeof binding !== "object") return undefined;
  const candidate = binding as { fetch?: typeof fetch };
  if (typeof candidate.fetch !== "function") return undefined;
  const bindingFetch = candidate.fetch.bind(candidate);
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => bindingFetch(input, init)) as typeof fetch;
}

export function createRequestBookingRuntimeFetcher(event: Pick<RequestEvent, "platform">): typeof fetch | undefined {
  return createServiceBindingFetcher(event.platform?.env?.BOOKING_SERVICE);
}
