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

function compactValue(value) {
  try { return JSON.stringify(value); } catch { return String(value ?? ''); }
}

function directCorrelationScope(value) {
  if (!value || typeof value !== 'object') return value;
  return {
    request: value.request,
    url: value.url,
    path: value.path,
    logs: value.logs,
    message: value.message,
    payload: value.payload,
    event: value.event,
  };
}

function isContextOnlyMarker(marker) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(marker);
}

function getAnchorMarkers(markers) {
  return markers.filter((marker) => !isContextOnlyMarker(marker));
}

function objectContainsMarker(value, markers) {
  if (markers.length === 0) return true;
  const anchorMarkers = getAnchorMarkers(markers);
  if (anchorMarkers.length === 0) return false;
  const compact = compactValue(directCorrelationScope(value));
  return anchorMarkers.some((marker) => compact.includes(marker));
}

function hasGenerateCorrelationAnchor(value) {
  const compact = compactValue(directCorrelationScope(value));
  return compact.includes('/api/generate')
    && (compact.includes('\"event\":\"api.generate.start\"')
      || compact.includes('\"event\":\"api.generate.skill_index_context\"')
      || compact.includes('"event":"api.generate.start"')
      || compact.includes('"event":"api.generate.skill_index_context"'));
}

function isCorrelatedGenerateRecord(value, markers) {
  if (markers.length === 0) return true;
  return objectContainsMarker(value, markers) && hasGenerateCorrelationAnchor(value);
}

function collectCorrelationValues(value, values = []) {
  if (!value || typeof value !== 'object') return values;
  if (Array.isArray(value)) {
    for (const item of value) collectCorrelationValues(item, values);
    return values;
  }
  for (const [key, item] of Object.entries(value)) {
    if (['runId', 'smokeRunId', 'clientRequestId', 'sessionId', 'activeSessionId'].includes(key) && typeof item === 'string' && item.length > 0) {
      values.push(item);
    }
    if (item && typeof item === 'object') collectCorrelationValues(item, values);
  }
  return values;
}

function hasConflictingCorrelationValue(value, markers) {
  if (markers.length === 0) return false;
  return collectCorrelationValues(value).some((candidate) => !candidate.startsWith('[') && !markers.includes(candidate));
}

function collectCorrelatedStrings(value, events, relevantMarkers, markers = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(value.logs)) {
      for (const log of value.logs) {
        if (hasConflictingCorrelationValue(log, markers)) continue;
        collectRelevantStrings(log, events, relevantMarkers);
      }
      return;
    }
    if ('message' in value || 'payload' in value || 'event' in value) {
      if (hasConflictingCorrelationValue(value, markers)) return;
      collectRelevantStrings(value, events, relevantMarkers);
      return;
    }
  }
  collectRelevantStrings(value, events, relevantMarkers);
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
  const considerParsed = (value) => {
    if (value && typeof value === 'object' && Array.isArray(value.events)) {
      for (const event of value.events) considerParsed(event);
      return;
    }
    if (!isCorrelatedGenerateRecord(value, requiredMarkers)) return;
    collectCorrelatedStrings(value, events, relevantMarkers, requiredMarkers);
  };
  for (const record of splitJsonishRecords(text)) {
    let parsed;
    try {
      parsed = JSON.parse(record);
    } catch {
      if (isCorrelatedGenerateRecord(record, requiredMarkers)) collectRelevantStrings(record, events, relevantMarkers);
      continue;
    }
    considerParsed(parsed);
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
