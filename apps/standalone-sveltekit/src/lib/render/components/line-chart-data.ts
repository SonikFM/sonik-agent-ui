export interface LineChartDatum {
  label: string;
  value: number;
}

export type LineChartAggregate = "sum" | "count" | "avg" | null | undefined;

const MONTH_INDEX = new Map<string, number>([
  ["jan", 0],
  ["january", 0],
  ["feb", 1],
  ["february", 1],
  ["mar", 2],
  ["march", 2],
  ["apr", 3],
  ["april", 3],
  ["may", 4],
  ["jun", 5],
  ["june", 5],
  ["jul", 6],
  ["july", 6],
  ["aug", 7],
  ["august", 7],
  ["sep", 8],
  ["sept", 8],
  ["september", 8],
  ["oct", 9],
  ["october", 9],
  ["nov", 10],
  ["november", 10],
  ["dec", 11],
  ["december", 11],
]);

function numericValue(value: unknown): number {
  return typeof value === "number" ? value : parseFloat(String(value)) || 0;
}

function parseDateLikeLabel(label: string): number | null {
  const trimmed = label.trim();
  if (!trimmed) return null;

  const monthOnly = MONTH_INDEX.get(trimmed.toLowerCase());
  if (monthOnly !== undefined) return monthOnly;

  const monthYear = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const month = MONTH_INDEX.get(monthYear[1].toLowerCase());
    if (month !== undefined) return Number(monthYear[2]) * 12 + month;
  }

  const yearMonth = trimmed.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (yearMonth) {
    const month = Number(yearMonth[2]);
    if (month >= 1 && month <= 12) return Number(yearMonth[1]) * 12 + month - 1;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sortDateLikeLineChartData(data: LineChartDatum[]): LineChartDatum[] {
  const indexed = data.map((datum, index) => ({ datum, index, order: parseDateLikeLabel(datum.label) }));
  if (indexed.length < 2 || indexed.some((entry) => entry.order === null)) return data;
  return indexed
    .sort((a, b) => (a.order as number) - (b.order as number) || a.index - b.index)
    .map((entry) => entry.datum);
}

export function createLineChartData(input: {
  rawItems: Array<Record<string, unknown>>;
  xKey: string;
  yKey: string;
  aggregate?: LineChartAggregate;
}): LineChartDatum[] {
  const { rawItems, xKey, yKey, aggregate } = input;
  if (rawItems.length === 0) return [];

  if (!aggregate) {
    return sortDateLikeLineChartData(
      rawItems.map((item) => ({
        label: String(item[xKey] ?? ""),
        value: numericValue(item[yKey]),
      })),
    );
  }

  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const item of rawItems) {
    const groupKey = String(item[xKey] ?? "unknown");
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }

  const aggregated: LineChartDatum[] = [];
  for (const [key, group] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    let value: number;
    if (aggregate === "count") {
      value = group.length;
    } else if (aggregate === "sum") {
      value = group.reduce((sum, item) => sum + numericValue(item[yKey]), 0);
    } else {
      const sum = group.reduce((current, item) => current + numericValue(item[yKey]), 0);
      value = group.length > 0 ? sum / group.length : 0;
    }
    aggregated.push({ label: key, value });
  }
  return sortDateLikeLineChartData(aggregated);
}
