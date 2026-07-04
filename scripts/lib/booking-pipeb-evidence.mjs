const DEFAULT_RELEVANT_MARKERS = [
  'booking.',
  'tool.',
  'api.generate.skill_index_context',
  'booking.runtime.fetch',
  'command_input_preflight_failed',
];

function unique(values) {
  return [...new Set(values)];
}

function normalizeMarkers(markers) {
  return unique((markers ?? []).filter((marker) => typeof marker === 'string' && marker.length > 0));
}

function isRelevantText(value, relevantMarkers = DEFAULT_RELEVANT_MARKERS) {
  return relevantMarkers.some((marker) => value.includes(marker));
}

function objectContainsMarker(value, markers) {
  if (markers.length === 0) return true;
  try {
    return markers.some((marker) => JSON.stringify(value).includes(marker));
  } catch {
    return markers.some((marker) => String(value ?? '').includes(marker));
  }
}

function splitJsonishRecords(text) {
  const records = [];
  for (const line of String(text ?? '').split('\n').filter(Boolean)) {
    records.push(line);
  }
  for (const chunk of String(text ?? '').split(/\n(?=\{)/).filter(Boolean)) {
    if (!records.includes(chunk)) records.push(chunk);
  }
  return records;
}

function collectRelevantStrings(value, events, relevantMarkers = DEFAULT_RELEVANT_MARKERS) {
  if (value == null) return;
  if (typeof value === 'string') {
    if (isRelevantText(value, relevantMarkers)) events.push(value);
    try { collectRelevantStrings(JSON.parse(value), events, relevantMarkers); } catch {}
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRelevantStrings(item, events, relevantMarkers);
    return;
  }
  if (typeof value === 'object') {
    const compact = JSON.stringify(value);
    if (isRelevantText(compact, relevantMarkers)) events.push(compact);
    for (const item of Object.values(value)) collectRelevantStrings(item, events, relevantMarkers);
  }
}

export function extractPipeBToolEvents(text, { markers = [], relevantMarkers = DEFAULT_RELEVANT_MARKERS } = {}) {
  const requiredMarkers = normalizeMarkers(markers);
  const events = [];
  for (const record of splitJsonishRecords(text)) {
    let parsed;
    try {
      parsed = JSON.parse(record);
    } catch {
      if (objectContainsMarker(record, requiredMarkers)) collectRelevantStrings(record, events, relevantMarkers);
      continue;
    }
    if (!objectContainsMarker(parsed, requiredMarkers)) continue;
    collectRelevantStrings(parsed, events, relevantMarkers);
  }
  return unique(events);
}

export function hasTelemetryEvent(events, identifier, eventName, ok) {
  return events.some((line) => {
    if (!line.includes(identifier) || !line.includes(`"event":"${eventName}"`)) return false;
    if (ok === undefined) return true;
    return line.includes(`"ok":${ok ? 'true' : 'false'}`);
  });
}

export function hasEventName(events, eventName, ok) {
  return events.some((line) => {
    if (!line.includes(`"event":"${eventName}"`)) return false;
    if (ok === undefined) return true;
    return line.includes(`"ok":${ok ? 'true' : 'false'}`);
  });
}

export function countRelevantPipeBLines(text, markers = []) {
  const requiredMarkers = normalizeMarkers(markers);
  return String(text ?? '')
    .split('\n')
    .filter(Boolean)
    .filter((line) => objectContainsMarker(line, requiredMarkers) && isRelevantText(line))
    .length;
}
