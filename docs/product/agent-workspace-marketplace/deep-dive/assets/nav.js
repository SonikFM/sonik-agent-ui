// Suite navigation + shared manifest for the marketplace deep-dive pages.
// Each page declares <body data-doc="<id>"> and includes this script (defer).
// Renders: sticky nav (title, group links, doc jump select) + prev/next pager.
// file://-safe, no dependencies.

(function () {
  "use strict";

  const GROUPS = [
    { id: "strategy", label: "Strategy" },
    { id: "contracts", label: "Contracts" },
    { id: "trust", label: "Trust & Runtime" },
    { id: "delivery", label: "Delivery & Ops" },
  ];

  const DOCS = [
    { id: "00-strategy", file: "00-strategy.html", group: "strategy", num: "00", title: "Product Strategy & PRD" },
    { id: "01-story-map", file: "01-story-map.html", group: "strategy", num: "01", title: "Opportunity, Story Map & Release Slices" },
    { id: "10-roadmap-risks", file: "10-roadmap-risks.html", group: "strategy", num: "10", title: "Roadmap, Risks & Open Questions" },
    { id: "decisions", file: "decisions.html", group: "strategy", num: "DR", title: "Ratified Decisions D001–D017" },
    { id: "03-package-contracts", file: "03-package-contracts.html", group: "contracts", num: "03", title: "Package & Bundle Contracts" },
    { id: "04-json-render-apps", file: "04-json-render-apps.html", group: "contracts", num: "04", title: "Command-Backed Apps & JSON-Render" },
    { id: "05-workflows-skills", file: "05-workflows-skills.html", group: "contracts", num: "05", title: "Workflows, Agents, Skills & Tool Packs" },
    { id: "06-endpoints-data", file: "06-endpoints-data.html", group: "contracts", num: "06", title: "Endpoint Map & Data Model" },
    { id: "02-system-map", file: "02-system-map.html", group: "trust", num: "02", title: "System Map & Boundaries" },
    { id: "07-trust-boundary", file: "07-trust-boundary.html", group: "trust", num: "07", title: "Permissions, Approval & Trust Boundary" },
    { id: "research-stateful", file: "research-stateful.html", group: "trust", num: "R1", title: "Stateful Runtimes Landscape (July 2026)" },
    { id: "research-competitors", file: "research-competitors.html", group: "trust", num: "R2", title: "Workflow Competitor Analysis (July 2026)" },
    { id: "08-telemetry-readiness", file: "08-telemetry-readiness.html", group: "delivery", num: "08", title: "Telemetry, Proof & Readiness Gates" },
    { id: "09-design-handoff", file: "09-design-handoff.html", group: "delivery", num: "09", title: "Design Handoff & Component Map" },
    { id: "11-operations", file: "11-operations.html", group: "delivery", num: "11", title: "Operations Runbook" },
  ];

  const docId = document.body.getAttribute("data-doc");
  const isIndex = docId === "index" || !docId;
  const current = DOCS.find((d) => d.id === docId) || null;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children || []) node.appendChild(child);
    return node;
  }

  // Sticky suite nav
  const tabs = el("nav", { class: "suite-tabs", "aria-label": "Document groups" });
  for (const group of GROUPS) {
    const link = el("a", {
      class: "suite-tab" + (current && current.group === group.id ? " active" : ""),
      href: "index.html#" + group.id,
      text: group.label,
    });
    if (current && current.group === group.id) link.setAttribute("aria-current", "true");
    tabs.appendChild(link);
  }

  const select = el("select", { class: "suite-doc-select", "aria-label": "Jump to document" });
  select.appendChild(el("option", { value: "index.html", text: "Index — all documents" }));
  for (const group of GROUPS) {
    const optgroup = el("optgroup", { label: group.label });
    for (const doc of DOCS.filter((d) => d.group === group.id)) {
      const option = el("option", { value: doc.file, text: doc.num + " · " + doc.title });
      if (current && doc.id === current.id) option.setAttribute("selected", "");
      optgroup.appendChild(option);
    }
    select.appendChild(optgroup);
  }
  select.addEventListener("change", () => { window.location.href = select.value; });

  const nav = el("div", { class: "suite-nav" }, [
    el("div", { class: "suite-nav-inner" }, [
      el("div", { class: "suite-title" }, [
        el("a", { href: "index.html", text: "Agent Marketplace — Deep Dive" }),
      ]),
      tabs,
      select,
    ]),
  ]);
  document.body.prepend(nav);

  // Prev / next pager on doc pages, in DOCS order
  if (current) {
    const index = DOCS.indexOf(current);
    const previous = DOCS[index - 1];
    const next = DOCS[index + 1];
    const pager = el("div", { class: "doc-pager" });
    pager.appendChild(
      previous
        ? el("a", { href: previous.file }, [
            el("span", { class: "pager-label", text: "Previous" }),
            el("span", { text: previous.num + " · " + previous.title }),
          ])
        : el("span", {}),
    );
    pager.appendChild(
      next
        ? el("a", { href: next.file, style: "text-align:right" }, [
            el("span", { class: "pager-label", text: "Next" }),
            el("span", { text: next.num + " · " + next.title }),
          ])
        : el("span", {}),
    );
    const page = document.querySelector(".page") || document.body;
    page.appendChild(pager);
  }

  // Expose manifest for index.html filtering
  window.__deepDiveManifest = { GROUPS, DOCS };
})();
