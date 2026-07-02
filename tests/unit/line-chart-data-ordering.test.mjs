import assert from "node:assert/strict";
import { createLineChartData } from "../../apps/standalone-sveltekit/src/lib/render/components/line-chart-data.ts";

const unorderedMonths = createLineChartData({
  rawItems: [
    { month: "Apr", bookings: 14 },
    { month: "Jun", bookings: 9 },
    { month: "May", bookings: 22 },
  ],
  xKey: "month",
  yKey: "bookings",
});
assert.deepEqual(
  unorderedMonths.map((item) => item.label),
  ["Apr", "May", "Jun"],
  "date-like month x values are sorted chronologically",
);
assert.deepEqual(
  unorderedMonths.map((item) => item.value),
  [14, 22, 9],
  "values stay attached to their month labels after sorting",
);

const aggregatedMonths = createLineChartData({
  rawItems: [
    { month: "Jun", bookings: 3 },
    { month: "Apr", bookings: 4 },
    { month: "May", bookings: 5 },
    { month: "Jun", bookings: 6 },
  ],
  xKey: "month",
  yKey: "bookings",
  aggregate: "sum",
});
assert.deepEqual(
  aggregatedMonths,
  [
    { label: "Apr", value: 4 },
    { label: "May", value: 5 },
    { label: "Jun", value: 9 },
  ],
  "aggregated month groups are sorted chronologically instead of alphabetically",
);

const categories = createLineChartData({
  rawItems: [
    { stage: "Prospect", total: 7 },
    { stage: "Closed", total: 2 },
    { stage: "Negotiation", total: 4 },
  ],
  xKey: "stage",
  yKey: "total",
});
assert.deepEqual(
  categories.map((item) => item.label),
  ["Prospect", "Closed", "Negotiation"],
  "non-date x values keep source order",
);

console.log("line-chart-data-ordering.test.mjs: all assertions passed");
