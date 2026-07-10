import { autoFixSpec, validateSpec, type Spec, type SpecFix, type SpecValidationIssues } from "@json-render/core";

/**
 * Shared choke point for the createJsonArtifact/createBookingIntakeArtifact
 * tool-execute lanes: both only ever run once the AI SDK has resolved a tool
 * call's full input (`execute` fires on `tool-input-available`, never on a
 * still-streaming `input-streaming` part), so `streamComplete` is always true
 * at those call sites. Any future caller that wants to repair a spec while it
 * is still progressively mounting (see json-ui-runtime's streaming preview
 * lane, which deliberately never reaches this helper) must pass `false` so
 * the loop is skipped -- dangling children are expected mid-stream and must
 * not be pruned before the rest of the spec arrives.
 */
export interface SpecRepairOptions {
  streamComplete: boolean;
  /**
   * Allow lossy terminal fixes such as pruning dangling children. Defaults to
   * true to preserve existing intake/runtime repair behavior.
   */
  allowLossy?: boolean;
}

export interface SpecRepairResult {
  spec: Spec;
  validation: SpecValidationIssues;
  /** True if any fix (lossless and/or lossy) was applied. */
  repaired: boolean;
  /** True if a lossy fix (content pruning) was applied. */
  lossy: boolean;
  fixDetails: SpecFix[];
}

function isSpecShaped(value: unknown): value is Spec {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { root?: unknown; elements?: unknown };
  return (
    typeof candidate.root === "string" &&
    Boolean(candidate.elements) &&
    typeof candidate.elements === "object" &&
    !Array.isArray(candidate.elements)
  );
}

/**
 * Repair loop mirroring @json-render/core's own guidance: validate, apply
 * lossless fixes (relocate misplaced fields) and revalidate, then -- only on
 * a terminal (stream-complete) attempt and only if still invalid -- apply
 * lossy fixes (prune dangling children) and revalidate. Callers use
 * `validation.valid` to decide whether to render the repaired spec or fall
 * back to the existing degraded/rejection path.
 *
 * Returns null when `candidate` is not even minimally spec-shaped (missing
 * root/elements) or when the stream is not complete -- callers should treat
 * that as "no repair attempted" and keep using the original candidate.
 */
export function repairSpec(candidate: unknown, options: SpecRepairOptions): SpecRepairResult | null {
  if (!options.streamComplete || !isSpecShaped(candidate)) return null;

  const spec = candidate;
  const losslessFix = autoFixSpec(spec, { lossy: false });
  let current = losslessFix.fixDetails.length > 0 ? losslessFix.spec : spec;
  let fixDetails = losslessFix.fixDetails;
  let validation = validateSpec(current);

  if (validation.valid) {
    return {
      spec: current,
      validation,
      repaired: fixDetails.length > 0,
      lossy: false,
      fixDetails,
    };
  }

  if (options.allowLossy !== false) {
    const lossyFix = autoFixSpec(current, { lossy: true });
    if (lossyFix.fixDetails.length > 0) {
      current = lossyFix.spec;
      fixDetails = [...fixDetails, ...lossyFix.fixDetails];
      validation = validateSpec(current);
    }
  }

  return {
    spec: current,
    validation,
    repaired: fixDetails.length > 0,
    lossy: fixDetails.some((fix) => fix.lossy),
    fixDetails,
  };
}
