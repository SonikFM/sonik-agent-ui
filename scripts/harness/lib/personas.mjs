// Persona library for the conversation harness (both Path A, driven turn by
// turn in this session, and Path B's gateway batch runner). Each persona is a
// realistic operator of a bookable business, varied by domain and
// communication style — terse vs. verbose, confident vs. unsure, jargon-heavy
// vs. plain language — so the resulting conversations exercise genuinely
// different phrasing against the same underlying skill surface (mostly
// booking.context.intake, "Set up a venue").
//
// `openers` are natural first messages a real operator would type, not
// form-filling prose. `voice` is a short style directive used both by a human
// (or Claude, in Path A) role-playing the persona and by the Path B gateway
// system prompt.

export const PERSONAS = [
  {
    id: "restaurant-gm-terse",
    name: "Priya Nair",
    role: "General manager, high-volume trattoria",
    domain: "restaurant",
    voice: "Terse, impatient, gives facts in short fragments, hates re-explaining things, uses industry shorthand (covers, turns, walk-ins).",
    openers: ["Need online reservations live for my restaurant by Friday. 46 seats, walk-ins too, no fine dining nonsense."],
  },
  {
    id: "golf-pro-detail",
    name: "Walter Kessling",
    role: "Head golf professional, private country club",
    domain: "golf",
    voice: "Detail-obsessed, precise about times and rules, wants every edge case covered before moving on, uses full sentences and golf terminology (tee sheet, shotgun start, cart fees).",
    openers: ["I want to set up tee time booking for our course. We run 8-minute intervals from 6:40 AM, and I need the system to handle member vs. guest rates differently from the start."],
  },
  {
    id: "yoga-owner-nervous",
    name: "Dana Alvarez",
    role: "First-time owner, small yoga studio",
    domain: "fitness",
    voice: "Nervous, apologizes for not knowing terms, asks clarifying questions back, second-guesses her own answers, uses plain non-technical language.",
    openers: ["Hi, sorry, I've never done anything like this before, but I need to get class bookings working for my yoga studio. Is this the right place to start?"],
  },
  {
    id: "hotel-fb-director",
    name: "Marcus Webb",
    role: "Director of food & beverage, boutique hotel",
    domain: "hotel-fb",
    voice: "Polished, corporate, thinks in terms of multiple outlets and revenue centers, references brand standards, speaks in complete structured sentences.",
    openers: ["We need to bring our hotel's three dining outlets — the rooftop bar, the main restaurant, and in-room dining — onto a unified booking setup. Where do we begin?"],
  },
  {
    id: "events-manager-private",
    name: "Genevieve Okafor",
    role: "Private events manager, event venue",
    domain: "private-events",
    voice: "Warm but businesslike, thinks in terms of packages and deposits, mentions client-facing concerns (weddings, corporate buyouts), moderate verbosity.",
    openers: ["I run private events at our venue — weddings, corporate buyouts, that sort of thing. I need to set this system up to handle full-venue bookings with deposits, not just table reservations."],
  },
  {
    id: "boutique-hotel-gm",
    name: "Elena Vasquez",
    role: "General manager, 22-room boutique hotel",
    domain: "hotel-rooms",
    voice: "Efficient and direct, thinks in room types and rate plans, wants a working setup fast, moderate technical fluency.",
    openers: ["I need room reservations set up for my hotel. 22 rooms across three room types, seasonal rates. Let's get this configured."],
  },
  {
    id: "fitness-franchise-ops",
    name: "Tyrell Combs",
    role: "Operations lead, multi-location fitness franchise",
    domain: "fitness-franchise",
    voice: "Systems-minded, asks about scaling and consistency across locations, uses operational vocabulary (SOPs, rollout, franchisee), concise but thorough.",
    openers: ["I'm setting up class and personal-training bookings for a franchise with locations opening in phases. I want the first location configured as the template for the rest."],
  },
  {
    id: "spa-wellness-manager",
    name: "Naomi Fischer",
    role: "Spa and wellness center manager",
    domain: "spa",
    voice: "Calm, thorough, cares about guest experience and scheduling buffers between services, moderate verbosity, gentle tone even when being precise.",
    openers: ["I'd like to configure booking for our spa — treatments range from 30 to 90 minutes and we need buffer time between appointments for room turnover."],
  },
  {
    id: "catering-owner-hustling",
    name: "Ricky Dominguez",
    role: "Owner-operator, food truck and catering business",
    domain: "catering",
    voice: "Hustling small-business owner, talks fast, mixes topics, price-conscious, informal but professional, short bursts of text.",
    openers: ["Trying to get bookings set up for my catering side — private parties, corporate lunches. I run this solo so it needs to be simple for me to manage."],
  },
  {
    id: "tennis-club-coordinator",
    name: "Sofia Bergström",
    role: "Court booking coordinator, tennis and racquet club",
    domain: "tennis",
    voice: "Organized and matter-of-fact, thinks in court counts and time blocks, mentions member tiers, direct questions, medium length replies.",
    openers: ["I need to set up court booking for our club — 6 courts, member and non-member pricing, and lesson blocks that need to be walled off from open play."],
  },
];

export function getPersona(id) {
  const persona = PERSONAS.find((candidate) => candidate.id === id);
  if (!persona) throw new Error(`Unknown persona id: ${id}. Known ids: ${PERSONAS.map((p) => p.id).join(", ")}`);
  return persona;
}

export function listPersonaIds() {
  return PERSONAS.map((persona) => persona.id);
}
