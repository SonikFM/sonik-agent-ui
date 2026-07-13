# Market Perspective — SMB AI Adoption (research brief, 2026-07-13)

Sonnet researcher output, verbatim.

---

## Q1: Adoption share + trajectory

1. 77% of US SMBs use AI regularly, up from 48% July 2024 — Intuit QuickBooks 2026 AI Impact Report (34,000+ survey + 5.3M QuickBooks accounts). quickbooks.intuit.com/r/small-business-data/ai-impact-report/

2. 58% of US small businesses used AI in 2025, up from 23% in 2023 — U.S. Chamber of Commerce "Empowering Small Business" (3,870 businesses, June 2025).

3. 46% of small businesses use AI customer-engagement tools (chatbots/automated response); 42% generative chatbots; 64% plan chatbot deployment by 2026 — Thryv survey July 2025 (secondary-sourced, moderate confidence).

4. COUNTERPOINT (highest-rigor source): only 17.7% of small businesses had formally ADOPTED AI services by end-2025 per JPMorganChase Institute TRANSACTION data (April 14, 2026). Employer firms 26.1%; nonemployer 15.3%. Self-report surveys likely overstate. jpmorganchase.com/institute — "Understanding the use of AI among small businesses."

5. New cohorts adopt much faster: 2025 formation cohort hit 10% AI adoption within 6 months vs 77 months for 2019 cohort — JPMC Institute, April 2026.

6. Restaurants: 26% use AI (NRA Feb 2026) but 86% comfortable with AI and 81% plan to increase.

## Q2: What's working vs churning

7. Consistent-to-sporadic user ratio rebounded to 1.7 (2025) from 1.2 (2023); firms using 3+ AI services grew <1% (2019) → 9.4% (2025) — JPMC Institute.

8. Top working use cases (Intuit 2026): marketing 45%, customer service 37%, bookkeeping 35%.

9. Salesforce SMB Trends (6th ed, 2026): 77% of SMBs rank marketing/customer engagement top AI priority; chatbots for basic service = retained use case.

10. Phone answering/booking = highest-traction customer-facing use case: 43% of restaurant calls go unanswered at peak; AI phone agents capture lost revenue directly — CallMissed/CloudTalk roundups 2026 (secondary, consistent with Toast data).

11. Toast IQ first 90 days: sales/revenue 47%, menu/inventory 34%, guest/marketing 32% — real day-to-day reuse, not trials. Businesswire June 2026.

12. AI-native SaaS churn: median GRR 40% vs 63% for comparable B2B SaaS. Under-$50/month products: 23% GRR; $50–249/month: 45% GRR — underpriced/broad tools churn fastest (aggregator-cited benchmark, flag for verification).

13. Gartner: 30% of genAI projects abandoned after PoC by end-2026 (data quality, unclear value, cost) — enterprise-skewed.

## Q3: Failure/non-adoption reasons

14. Skills gap dominant: 45% cite lack of technical expertise; 47% find tool choice difficult (Goldman Sachs 2026). 50–70% across verticals cite AI skills as primary barrier.

15. Data security/compliance #1 barrier (27%), ahead of ROI uncertainty (24%).

16. Accuracy: 36% of active users cite accuracy concerns in high-stakes domains; 34% worry where sensitive data goes.

17. Cost is NOT the primary barrier: only 18% cite cost — real friction is evaluation/setup/maintenance overhead. Entry pricing fell ~$50/mo (2019) → $20–30/mo (2025), JPMC.

18. Workflow-integration failure mode (the Dify/n8n/Zapier thesis): "Most SMBs add AI tools without redesigning the workflow around them → parallel processes (AI output + manual check) with no net efficiency gain" — tool bolted on, labor savings never materialize. (Aggregator, directionally credible.)

## Q4: Evidence for "less than Dify/n8n/Zapier, delivered better"

19. Vertical deployments reportedly 2.3x ROI vs horizontal; 71% of vertical deployments still generating value at 6 months vs 32% horizontal — attributed to McKinsey State of AI 2025 but NOT verified against primary source; appears only in aggregators. UNVERIFIED — direction consistent, numbers cautioned.

20. No direct "we tried n8n/Zapier and gave up" survey data, but structural argument well-supported: n8n requires "technical ownership"; Zapier becomes "restrictive" at conditionals/loops/retries — horizontal tools force a skills tradeoff SMBs (finding 14) can't staff.

21. Multi-service adoption only 9.4% of firms (2025, JPMC) — the vast majority use one or two narrow AI services, not a platform. Circumstantial support for "narrow tool done well."

22. Hospitality vertical tools show strong outcomes: direct-booking lift +14pts, cost-per-direct-booking -19%, review-response cycle -81% (digitalapplied.com, vendor-adjacent, directional). Purpose-built hospitality chatbots (Asksuite, Canary) hold #1 HotelTechReport rankings, ~1,000+ verified hotelier reviews, 98% recommendation — real retention signal for vertical tools.

## Q5: Pricing tolerance

23. Median SMB AI spend 2025: ~$28/month (down from $78 market median 2022). 2019-cohort loyalists grew $50→$90/month by 2025; 2024 cohort started $20, grew to $28. JPMC transaction data — highest confidence pricing point.

24. Per-seat: $20/month common (ChatGPT Plus/Claude Pro); $20–40/user = SMB sweet spot.

25. Per-resolution gaining traction: Intercom $0.99, Zendesk $1.50/resolution — pitched as scaling with value not headcount.

26. Voice/phone AI: $0.07–$0.12/minute vs human answering service $1.50–$3.00/minute — 20x+ cost argument driving the phone-answering wedge.

27. 30.8% of genAI users maintained consistent monthly payment in 2025, up from 4% in 2020 — recurring AI spend normalizing. JPMC.

## Researcher implications for a hospitality-vertical AI agent platform

- Trust the JPMC transaction baseline (17.7% adoption, $28/month median, 9.4% multi-service), not the 58–77% survey numbers: most SMBs use ONE narrow tool. Favors single-purpose vertical product over platform.
- Phone/booking answering is the best-evidenced wedge: narrow, ROI-visible (43% of calls unanswered), ~20x cheaper than human alternative, proven category (Slang.ai, Loman) — study their packaging.
- Skills gap (45-70%), not cost (18%), is the blocker: sell "zero setup burden," not "cheaper."
- Outcome/per-minute pricing out-executing per-seat for customer-facing agents — consider per-booking/per-resolved-inquiry over flat per-seat (NB: cross-check against Fin brief's finding that per-resolution billing is also Fin's #1 complaint — resolution DEFINITION is the fight; verifiable receipts fix the dispute).
- Vertical tools (Asksuite, Canary, Toast IQ) show reuse signals horizontal builders structurally can't match for this segment — strongest qualitative support for "less but better, vertical-specific." The 2.3x McKinsey stat needs primary verification before citing externally.

Caveats: several stats trace to SEO/aggregator content, flagged inline. Highest confidence: JPMorganChase Institute (transactions), Intuit (34K+5.3M), US Chamber (3,870), NRA.
