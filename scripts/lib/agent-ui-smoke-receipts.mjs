function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getPath(value, path) {
  let current = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record || !(key in record)) return undefined;
    current = record[key];
  }
  return current;
}

function firstStringAtPaths(value, paths) {
  for (const path of paths) {
    const found = nonEmptyString(getPath(value, path));
    if (found) return found;
  }
  return null;
}

function stepForCommand(body, commandId) {
  const steps = Array.isArray(asRecord(body)?.steps) ? asRecord(body).steps : [];
  return steps.find((step) => asRecord(step)?.commandId === commandId) ?? null;
}

export function extractRuntimeReceiptId(value) {
  return firstStringAtPaths(value, [
    ['receipt', 'summary', 'receipt', 'confirmation', 'id'],
    ['receipt', 'summary', 'receipt', 'confirmation', 'contextId'],
    ['receipt', 'summary', 'receipt', 'confirmation', 'bookingId'],
    ['receipt', 'summary', 'body', 'id'],
    ['receipt', 'summary', 'body', 'contextId'],
    ['receipt', 'summary', 'body', 'bookingId'],
    ['receipt', 'summary', 'receipt', 'id'],
    ['receipt', 'summary', 'receipt', 'contextId'],
    ['receipt', 'summary', 'receipt', 'bookingId'],
    ['receipt', 'summary', 'id'],
    ['receipt', 'summary', 'contextId'],
    ['receipt', 'summary', 'bookingId'],
    ['receipt', 'confirmation', 'id'],
    ['receipt', 'confirmation', 'contextId'],
    ['receipt', 'confirmation', 'bookingId'],
    ['body', 'id'],
    ['body', 'contextId'],
    ['body', 'bookingId'],
    ['confirmation', 'id'],
    ['confirmation', 'contextId'],
    ['confirmation', 'bookingId'],
    ['id'],
    ['contextId'],
    ['bookingId'],
  ]);
}

export function inspectReservationCommitBody(body) {
  const record = asRecord(body);
  const guestStep = stepForCommand(record, 'booking.create.guest');
  const bookingStep = stepForCommand(record, 'booking.create.booking');
  const guestReceipt = asRecord(asRecord(guestStep)?.receipt);
  const bookingReceipt = asRecord(asRecord(bookingStep)?.receipt);
  const guestId = nonEmptyString(record?.guestId);
  const bookingReceiptId = extractRuntimeReceiptId(bookingStep) ?? extractRuntimeReceiptId(bookingReceipt);
  return {
    ok: record?.ok === true,
    kind: record?.kind === 'reservation-commit' ? record.kind : null,
    guestId,
    guestReceiptOk: guestReceipt?.ok === true,
    bookingReceiptOk: bookingReceipt?.ok === true,
    bookingReceiptId,
    logicalOk: record?.ok === true
      && Boolean(guestId)
      && guestReceipt?.ok === true
      && bookingReceipt?.ok === true
      && Boolean(bookingReceiptId),
  };
}

export function inspectIntakeCommitBody(body) {
  const record = asRecord(body);
  const receipt = asRecord(record?.receipt);
  const createdContextId = extractRuntimeReceiptId(record) ?? extractRuntimeReceiptId(receipt);
  return {
    ok: record?.ok === true,
    kind: record?.kind === 'intake-command-commit' ? record.kind : null,
    receiptOk: receipt?.ok === true,
    commandId: nonEmptyString(asRecord(record?.command)?.commandId),
    createdContextId,
    logicalOk: record?.ok === true && receipt?.ok === true && Boolean(createdContextId),
  };
}
