// Minimal scorer, per docs/plans/high-volume-agent-harness-testing-2026-07-07.md
// ("a minimal scorer ships with P1 so the first runs are already measured").
// Computes 4 of the plan's 5 behavior-scoring metrics from a single run's
// collected turns; the 5th (phrasing sensitivity) needs N phrasings of the
// same scenario compared against each other and is explicitly P2/P3 work
// (the scenario generator doesn't exist yet).
//
// Inputs are the plain data the CLI already collects while driving a run —
// no telemetry/R2 reads here (that's the L2/L3 replay-banking + Dev MCP
// layer in the plan, P3+). This scorer only sees what the driver itself saw
// over HTTP: each /api/generate turn's reduced { text, toolCalls, error },
// and the recipe registered for the scenario's target command family.

const DEFAULT_BOOKING_CONTEXT_CREATE_RECIPE = [
  "searchSkillCatalog",
  "learnSkill",
  "readActiveArtifactState",
  "previewActiveIntakeCommand",
  "commitActiveIntakeCommand",
];

const REFUSAL_PATTERNS = [
  /\bi can'?t (do that|help with that|execute|run that)\b/i,
  /\bi(?:'m| am) not able to\b/i,
  /\bthat('?s| is) outside (my|the) scope\b/i,
  /\bi won'?t\b/i,
];

/**
 * did-it-call-the-declared-sequence check. Off-recipe calls are named, not
 * just counted, so a drift report can say *what* fired instead of the
 * expected step (the audit's ask: "off-recipe calls named").
 */
export function scoreRecipeAdherence(turns, { recipe = DEFAULT_BOOKING_CONTEXT_CREATE_RECIPE } = {}) {
  const calledToolNames = turns.flatMap((turn) => (turn.toolCalls ?? []).map((call) => call.toolName)).filter(Boolean);
  const recipeSet = new Set(recipe);
  const matchedInOrder = [];
  let cursor = 0;
  for (const name of calledToolNames) {
    if (name === recipe[cursor]) {
      matchedInOrder.push(name);
      cursor += 1;
    }
  }
  const offRecipeCalls = calledToolNames.filter((name) => !recipeSet.has(name));
  return {
    recipe,
    calledToolNames,
    matchedSteps: matchedInOrder.length,
    totalSteps: recipe.length,
    adhered: matchedInOrder.length === recipe.length,
    offRecipeCalls: [...new Set(offRecipeCalls)],
  };
}

/**
 * execute-vs-narrate: did a claimed mutating action (commit) actually
 * produce a receipt/output, versus the assistant narrating success in text
 * without a corresponding tool call. Current baseline the plan cites is
 * "~2/3 on reservation" for the real agent; this driver reports the same
 * shape of signal from whatever turns it collected.
 */
export function scoreExecuteVsNarrate(turns, { commitToolName = "commitActiveIntakeCommand" } = {}) {
  const commitCalls = turns.flatMap((turn) => turn.toolCalls ?? []).filter((call) => call.toolName === commitToolName);
  const commitCallWithReceipt = commitCalls.find((call) => call.output !== undefined && !call.error);
  const narratesCompletion = turns.some((turn) => /\b(created|committed|approved and (created|ran))\b/i.test(turn.text ?? ""));
  return {
    commitToolName,
    commitCallCount: commitCalls.length,
    hasReceipt: Boolean(commitCallWithReceipt),
    narratesCompletionInText: narratesCompletion,
    // The dangerous case: narrates success but never actually called commit.
    narrateWithoutExecute: narratesCompletion && !commitCallWithReceipt,
  };
}

/** turn economy: tool calls + turns per completed workflow. */
export function scoreTurnEconomy(turns) {
  const toolCallCount = turns.reduce((sum, turn) => sum + (turn.toolCalls?.length ?? 0), 0);
  return {
    turnCount: turns.length,
    toolCallCount,
    toolCallsPerTurn: turns.length > 0 ? Number((toolCallCount / turns.length).toFixed(2)) : 0,
  };
}

/**
 * refusal correctness: when a scenario is tagged expectRefusal, did the
 * assistant actually refuse (typed pattern match) rather than argue/comply?
 * When a scenario is NOT tagged expectRefusal, a refusal pattern firing
 * anyway is scored as a false-positive refusal.
 */
export function scoreRefusalCorrectness(turns, { expectRefusal = false } = {}) {
  const refused = turns.some((turn) => REFUSAL_PATTERNS.some((pattern) => pattern.test(turn.text ?? "")));
  return {
    expectRefusal,
    refused,
    correct: expectRefusal ? refused : !refused,
  };
}

export function scoreRun(input) {
  const { turns, recipe, commitToolName, expectRefusal } = input;
  return {
    schemaVersion: "sonik.agent_ui.harness_score.v1",
    recipeAdherence: scoreRecipeAdherence(turns, { recipe }),
    executeVsNarrate: scoreExecuteVsNarrate(turns, { commitToolName }),
    turnEconomy: scoreTurnEconomy(turns),
    refusalCorrectness: scoreRefusalCorrectness(turns, { expectRefusal }),
  };
}

export { DEFAULT_BOOKING_CONTEXT_CREATE_RECIPE };
