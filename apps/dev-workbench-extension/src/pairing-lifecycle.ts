export type PairingIdentity = {
  tabId: number;
  windowId: number;
  documentId: string;
  nonce: string;
};

type PairingContext = {
  origin: string;
  route: string;
  sourceContextRevision: number;
  routeRevision: number;
};

type Pairing = PairingIdentity & {
  expiresAt: number;
  generation: number;
  context: PairingContext | null;
  seenRequestIds: Set<string>;
};

export type PairingRequest = PairingIdentity & PairingContext & {
  operation: string;
  requestId: string;
};

export type PairingLease = PairingIdentity & { generation: number };

export function createPairingLifecycle({ now = Date.now, ttlMs = 5 * 60_000 } = {}) {
  const pairings = new Map<number, Pairing>();
  let generation = 0;

  function revoke(tabId: number) {
    return pairings.delete(tabId);
  }

  function establish(identity: PairingIdentity) {
    const pairing: Pairing = {
      ...identity,
      expiresAt: now() + ttlMs,
      generation: ++generation,
      context: null,
      seenRequestIds: new Set(),
    };
    pairings.set(identity.tabId, pairing);
    return pairing.expiresAt;
  }

  function authorize(request: PairingRequest): PairingLease | null {
    const pairing = pairings.get(request.tabId);
    if (!pairing || now() >= pairing.expiresAt || !sameIdentity(pairing, request)) {
      revoke(request.tabId);
      return null;
    }
    if (pairing.seenRequestIds.has(request.requestId)) return null;
    const context = contextOf(request);
    if (pairing.context === null) {
      if (request.operation !== "pair-extension") return null;
      pairing.context = context;
    } else if (!sameContext(pairing.context, context)) {
      revoke(request.tabId);
      return null;
    }
    pairing.seenRequestIds.add(request.requestId);
    return { tabId: pairing.tabId, windowId: pairing.windowId, documentId: pairing.documentId, nonce: pairing.nonce, generation: pairing.generation };
  }

  function isCurrent(lease: PairingLease, active: PairingIdentity) {
    const pairing = pairings.get(lease.tabId);
    if (!pairing || pairing.generation !== lease.generation || now() >= pairing.expiresAt || !sameIdentity(pairing, active)) {
      revoke(lease.tabId);
      return false;
    }
    return true;
  }

  return { establish, authorize, isCurrent, revoke, revokeAll: () => pairings.clear(), isPaired: (tabId: number) => pairings.has(tabId) };
}

function sameIdentity(left: PairingIdentity, right: PairingIdentity) {
  return left.tabId === right.tabId && left.windowId === right.windowId && left.documentId === right.documentId && left.nonce === right.nonce;
}

function contextOf(request: PairingRequest): PairingContext {
  return {
    origin: request.origin,
    route: request.route,
    sourceContextRevision: request.sourceContextRevision,
    routeRevision: request.routeRevision,
  };
}

function sameContext(left: PairingContext, right: PairingContext) {
  return left.origin === right.origin && left.route === right.route
    && left.sourceContextRevision === right.sourceContextRevision && left.routeRevision === right.routeRevision;
}
