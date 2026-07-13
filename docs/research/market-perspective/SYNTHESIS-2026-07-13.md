# Market Perspective — Synthesis (2026-07-13)

Synthesizes four sonnet research briefs (this directory: `intercom-fin`,
`smb-adoption`, `restaurant-venue-ai`, `event-organizer-ai`) against Dan's
thesis: *"my hunch is it's a lot less than what these platforms offer, with a
lot better experience when doing it. Our north star is workflows — the only
thing people care about is getting work done. Individualized hospitality
customer service is ours to exploit to the fullest."*

## Verdict on the hunch: CONFIRMED, by the strongest data in the pile

The highest-rigor source found (JPMorganChase Institute, actual transaction
data, Apr 2026) says the real SMB market is: **17.7% adoption** (not the
58–77% surveys claim), **$28/month median spend**, and **only 9.4% of firms
using 3+ AI services**. SMBs buy ONE narrow tool that works. The blocker is
not cost (18% cite it) but the skills/setup burden (45–70% cite it). And the
documented horizontal-tool failure mode is exactly Dan's: tools bolted onto
existing processes, output manually re-checked, no net gain. Vertical tools
(Asksuite, Canary, Toast IQ) show the retention signals horizontal builders
don't.

**Product argument that follows: zero setup burden — not "cheaper than Dify."**

## The six load-bearing market facts

1. **The benchmark got acquired.** Salesforce is buying Fin (Intercom) for
   ~$3.6B (announced 2026-06-15). The SMB-specialist tier is consolidating
   into giants' bundles; the market bifurcates into "the giant's bundled
   agent" vs "the specialist." A hospitality vertical specialist has room.
2. **The category has a credibility problem we can attack.** Fin advertises
   67–76% resolution / <1% hallucination; real-world case studies show
   42–50% resolution and independent grounding tests 38–72%. Marketed vs.
   measured is the category's open wound. Anything we claim should be
   *independently reproducible* — receipts make that native.
3. **The action-taking gap is real and unaudited.** Fin Tasks documents
   hospitality booking/reservation changes as a use case, but NO independent
   audit of action reliability exists anywhere for Fin, Decagon, or Sierra.
   Conversational resolution has third-party scrutiny; action success does
   not. **A published, verifiable action-success rate (bookings provably
   committed correctly) is a differentiator nobody can honestly match.**
4. **The wedge is the phone.** 43% of restaurant calls go unanswered at peak.
   Phone/booking answering is the proven, ROI-visible entry point (Slang.ai
   2,000+ locations at $399–599/mo/location; PolyAI $750M valuation; Popmenu
   6.1M calls; Fogo de Chão 88% booking completion vs 40–50% human baseline).
   Fine dining adopts MORE than fast-casual (Toast IQ +29%) — high-touch
   venues are the eager buyers.
5. **Guest memory beats a smarter chatbot.** SevenRooms' moat is the guest
   CRM ($20B+ annual guest spend managed; auto-tagging "Big Spender"/
   "No-Show"), not conversational IQ. Individualization = data + authority to
   act. We are the system of record — the structural advantage horizontal
   players can't buy.
6. **Organizers switch over stacked fees and lock-in, not headline rate.**
   ("Margins crushed, marketing scattered across five tools, vendor thinks
   processing payments = helping sell out an event.") 2026 DOJ/Live Nation
   settlement is a regulatory tailwind for switching. Transparent all-in
   pricing + no lock-in is a lever distinct from undercutting the ticket fee.

## Open field vs contested

**Open field (nobody has shipped it):**
- Artist/DJ booking coordination AI — does not exist; current tools
  (Prism.fm, Juro) automate paperwork (offers, holds, settlement reminders),
  not deal-making. Directly adjacent to our A2 reservation-commit lane.
- Attendee-facing pre-event support AI at the independent/mid-market tier —
  Bizzabo (Bizzy) and Ticketmaster serve the top; Posh/Partiful/Luma have
  shipped NO attendee AI. Gap below the enterprise tier.
- Guest-list/door-ops bundled into a booking platform — point solutions
  exist (GuestlistOnline, Attendium) against the WhatsApp+spreadsheet
  failure mode (500+ guests/3 promoters breaking Sheets weekly), but none
  bundled.
- Verifiable action-success receipts — no one publishes audited action
  reliability, period.

**Contested (not open, must out-execute):**
- Restaurant reservation answering/booking — crowded and proven (Slang.ai,
  PolyAI, Popmenu, Loman, Hostie); Decagon already markets restaurant
  booking upsell (tasting menus/private dining) at enterprise tier.
- Guest personalization CRM — SevenRooms is strong and shipping AI features
  (Note Polish, HeyPluto acquisition). We win only where booking authority +
  event context + receipts compose, not on CRM features alone.

## Pricing synthesis (resolves the briefs' apparent conflict)

SMB brief: outcome pricing out-executes per-seat for customer-facing agents.
Fin brief: per-resolution billing is Fin's #1 complaint — bills spiking 120%,
"assumed resolution" disputes (silence = charged). These reconcile: **outcome
pricing wins only when the outcome is verifiable.** Our receipt IS the
billing record — charge per provably completed booking/action, never per
assumed resolution. Anchor points: $28/mo median SMB AI spend overall;
$399–599/mo/location for proven phone answering; voice AI at $0.07–0.12/min
vs $1.50–3.00/min human. Hospitality operators already pay 10–20x the median
for tools that visibly capture revenue. Keep it predictable (caps/flat tiers)
— unpredictability, not price, is the complaint vector.

## What this means for what we build (feeds the interview)

- P1 guest surface = the phone/chat answering wedge with full booking
  lifecycle (create/modify/cancel/waitlist) and recognition from our guest
  data. The five-point "minimum lovable agent" (restaurant brief) is the P1
  spec: answer bulletproof first; lifecycle not just creation; hard-coded
  escalation boundary (large party / VIP / deposits / complaints → human
  with context); guest-memory layer; deposits + brand voice as first-class
  setup.
- The converged industry escalation boundary IS our default approval policy —
  we don't need to invent the line, we need to make crossing it signed,
  received, and auditable.
- P2 organizer console stays narrow (validated: 9.4% multi-service adoption;
  skills gap dominates). Setup-as-interview, not builder.
- Event-organizer expansion: pre-event attendee support AI (open at our
  tier), referral/SMS-CRM attribution (Posh's 53% stat = revealed
  preference), booking/settlement admin automation → A2 lane.
- Headline metric strategy: publish real resolution + audited action-success
  numbers. The category's marketing-vs-measured gap makes honesty a moat.

## Data gaps (don't cite externally without re-sourcing)

- McKinsey "2.3x vertical ROI" stat — aggregator-only, unverified.
- Pre-event support volume by category — no published data.
- Organizer willingness-to-pay survey — none exists.
- Restaurant guest-facing AI failure/backlash cases — none documented (quiet
  failures or underreporting).
- "Guest list breaks at ~30 people" — unverifiable.
