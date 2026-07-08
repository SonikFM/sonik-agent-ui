// Unit test for the persona harness's dataset-record extraction
// (scripts/harness/lib/extraction.mjs), the JSONL record shape the
// "authentic conversations against the deployed agent-ui" dataset is made
// of. Uses a synthetic conversation-store fixture (no network) covering both
// the QuestionCard intake shape and the generic-form-field fallback shape a
// real deployed-model conversation was observed to take, so the mapping from
// transcript -> {fullTranscript, questionsAsked, artifactSpecEvolution,
// scores, outcome} is verified without depending on a live agent-ui run.

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRunState, recordUserTurn, recordAssistantTurn } from '../../scripts/harness/lib/conversation-store.mjs';
import { buildDatasetRecord } from '../../scripts/harness/lib/extraction.mjs';

const repoRoot = path.join(os.tmpdir(), 'persona-extraction-test-fixture-root');
const persona = { id: 'fixture-persona', name: 'Fixture Persona', role: 'Test role', domain: 'fixture', voice: 'Plain, direct.' };

async function buildQuestionCardFixtureRecord() {
  const state = await createRunState({
    repoRoot,
    runId: 'fixture-run-questioncard',
    persona,
    path: 'A',
    baseUrl: 'https://example.invalid',
    sessionId: 'workspace-session-fixture',
  });
  // Avoid touching disk in this unit test: createRunState writes a state
  // file, but nothing downstream in this test reads it back from disk.

  recordUserTurn(state, 'I want to set up a venue for dinner reservations.');
  recordAssistantTurn(state, {
    messageId: 'm1',
    reduced: {
      messageId: 'm1',
      text: 'Opening the intake canvas.',
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'createBookingIntakeArtifact', input: { title: 'Dinner intake' }, output: { id: 'artifact-1' } },
      ],
      specPatches: [
        {
          type: 'flat',
          spec: {
            root: 'main',
            elements: {
              main: { type: 'Card', props: {}, children: ['q_intake_mode', 'q_inventory_core'] },
              q_intake_mode: {
                type: 'QuestionCard',
                props: { questionId: 'q_intake_mode', title: 'What are we configuring?', answerType: 'single_choice', required: true, writesTo: '/manifest/intakeMode', choices: [{ value: 'venue_schedule', label: 'Venue schedule' }] },
              },
              q_inventory_core: {
                type: 'QuestionCard',
                props: { questionId: 'q_inventory_core', title: 'What can customers book?', answerType: 'long_text', required: true, writesTo: '/manifest/inventory/coreDescription' },
              },
            },
            state: {
              surface: { skillId: 'booking.context.intake', id: 'fixture' },
              manifest: { source: { skill: 'booking.context.intake' } },
            },
          },
        },
      ],
      finishReason: 'stop',
      error: null,
      requestId: 'req-1',
      traceId: 'trace-1',
    },
  });

  recordUserTurn(state, 'Venue schedule. Dinner table reservations for 46 seats.');
  recordAssistantTurn(state, {
    messageId: 'm2',
    reduced: {
      messageId: 'm2',
      text: 'Answers captured, manifest is ready to preview.',
      toolCalls: [
        { toolCallId: 'call-2', toolName: 'readActiveArtifactState', input: {}, output: { ok: true } },
        { toolCallId: 'call-3', toolName: 'previewActiveIntakeCommand', input: {}, output: { ok: true, preview: true } },
      ],
      specPatches: [
        { type: 'patch', patch: { op: 'add', path: '/state/answers/q_intake_mode', value: 'venue_schedule' } },
        { type: 'patch', patch: { op: 'add', path: '/state/questionStates/q_intake_mode', value: 'answered' } },
        { type: 'patch', patch: { op: 'add', path: '/state/manifest/intakeMode', value: 'venue_schedule' } },
        { type: 'patch', patch: { op: 'add', path: '/state/answers/q_inventory_core', value: 'Dinner table reservations for 46 seats.' } },
        { type: 'patch', patch: { op: 'add', path: '/state/questionStates/q_inventory_core', value: 'answered' } },
        { type: 'patch', patch: { op: 'add', path: '/state/manifest/inventory/coreDescription', value: 'Dinner table reservations for 46 seats.' } },
      ],
      finishReason: 'stop',
      error: null,
      requestId: 'req-2',
      traceId: 'trace-2',
    },
  });

  return buildDatasetRecord(state, { outcome: 'reached_preview', outcomeNotes: 'Fixture reached preview_ready.', pipeBEvidence: { attempted: false, note: 'fixture' } });
}

async function buildGenericFormFixtureRecord() {
  const state = await createRunState({
    repoRoot,
    runId: 'fixture-run-genericform',
    persona,
    path: 'A',
    baseUrl: 'https://example.invalid',
    sessionId: 'workspace-session-fixture-2',
  });

  recordUserTurn(state, 'Need reservations live for my restaurant.');
  recordAssistantTurn(state, {
    messageId: 'm1',
    reduced: {
      messageId: 'm1',
      text: 'Here is a setup form.',
      toolCalls: [{ toolCallId: 'call-1', toolName: 'createJsonArtifact', input: { title: 'Form' }, output: { id: 'artifact-2' } }],
      specPatches: [
        {
          type: 'flat',
          spec: {
            root: 'main',
            elements: {
              main: { type: 'Stack', props: {}, children: ['name'] },
              name: { type: 'TextInput', props: { label: 'Restaurant name', name: 'restaurantName', required: true } },
            },
            state: {},
          },
        },
      ],
      finishReason: 'stop',
      error: null,
      requestId: 'req-3',
      traceId: 'trace-3',
    },
  });

  recordUserTurn(state, "It's called Trattoria Uno.");

  return buildDatasetRecord(state, { outcome: 'form_rendered_awaiting_fields', pipeBEvidence: { attempted: false, note: 'fixture' } });
}

const questionCardRecord = await buildQuestionCardFixtureRecord();

// --- Top-level record shape -------------------------------------------------
assert.equal(questionCardRecord.schemaVersion, 'sonik.agent_ui.persona_dataset_record.v1');
assert.equal(questionCardRecord.runId, 'fixture-run-questioncard');
assert.deepEqual(questionCardRecord.persona, persona);
assert.equal(questionCardRecord.sessionId, 'workspace-session-fixture');
assert.equal(questionCardRecord.artifactId, 'artifact-1', 'artifactId should be lifted from the createBookingIntakeArtifact tool output');
assert.ok(questionCardRecord.timestamps.startedAt, 'timestamps.startedAt must be set');
assert.ok(questionCardRecord.timestamps.finishedAt, 'timestamps.finishedAt must be set');

// --- fullTranscript ----------------------------------------------------------
assert.equal(questionCardRecord.fullTranscript.length, 4, 'transcript should have 2 user + 2 assistant turns');
assert.equal(questionCardRecord.fullTranscript[0].role, 'user');
assert.equal(questionCardRecord.fullTranscript[0].text, 'I want to set up a venue for dinner reservations.');
assert.equal(questionCardRecord.fullTranscript[1].role, 'assistant');
assert.equal(questionCardRecord.fullTranscript[1].workflowPhase, 'intake');
assert.equal(questionCardRecord.fullTranscript[3].workflowPhase, 'preview_ready', 'phase should resolve to preview_ready once both required manifest fields are patched in');
assert.equal(questionCardRecord.fullTranscript[3].toolCalls.some((call) => call.toolName === 'previewActiveIntakeCommand'), true);

// --- questionsAsked ------------------------------------------------------------
assert.equal(questionCardRecord.questionsAsked.length, 2, 'both QuestionCard elements should be tracked as questions');
const intakeModeQuestion = questionCardRecord.questionsAsked.find((q) => q.id === 'q_intake_mode');
assert.ok(intakeModeQuestion, 'q_intake_mode should be present');
assert.equal(intakeModeQuestion.source, 'QuestionCard');
assert.equal(intakeModeQuestion.answerType, 'single_choice');
assert.equal(intakeModeQuestion.required, true);
assert.equal(intakeModeQuestion.answerGiven, 'Venue schedule. Dinner table reservations for 46 seats.', 'answerGiven should be backfilled from the next user turn after the question first appeared');
assert.equal(intakeModeQuestion.firstSeenTurn, 2);
assert.equal(intakeModeQuestion.answeredTurn, 3);

// --- artifactSpecEvolution -----------------------------------------------------
assert.equal(questionCardRecord.artifactSpecEvolution.length, 3, 'one snapshot for the initial idle spec plus one per assistant turn');
assert.equal(questionCardRecord.artifactSpecEvolution[0].phase, 'idle');
assert.equal(questionCardRecord.artifactSpecEvolution[1].phase, 'intake');
assert.equal(questionCardRecord.artifactSpecEvolution[2].phase, 'preview_ready');
assert.equal(questionCardRecord.artifactSpecEvolution[2].spec.state.manifest.intakeMode, 'venue_schedule');

// --- scores ----------------------------------------------------------------
assert.equal(questionCardRecord.scores.schemaVersion, 'sonik.agent_ui.harness_score.v1');
assert.equal(questionCardRecord.scores.turnEconomy.turnCount, 2, 'scorer only counts assistant turns');
assert.equal(questionCardRecord.scores.turnEconomy.toolCallCount, 3);

// --- outcome -----------------------------------------------------------------
assert.equal(questionCardRecord.outcome.status, 'reached_preview');
assert.equal(questionCardRecord.outcome.finalPhase, 'preview_ready');
assert.equal(questionCardRecord.outcome.turnCount, 2);
assert.equal(questionCardRecord.outcome.notes, 'Fixture reached preview_ready.');

// --- telemetry passthrough ---------------------------------------------------
assert.deepEqual(questionCardRecord.telemetry.pipeB, { attempted: false, note: 'fixture' });

// --- Generic-form-field fallback shape (real deployed behavior for
// non-intake-routed conversations, see scripts/harness/lib/question-extractor.mjs) ---
const genericFormRecord = await buildGenericFormFixtureRecord();
assert.equal(genericFormRecord.questionsAsked.length, 1);
assert.equal(genericFormRecord.questionsAsked[0].source, 'generic-form-field');
assert.equal(genericFormRecord.questionsAsked[0].answerType, 'TextInput');
assert.equal(genericFormRecord.questionsAsked[0].answerGiven, "It's called Trattoria Uno.");
assert.equal(genericFormRecord.outcome.finalPhase, 'idle', 'a generic form (no booking.context.intake marker) never resolves to preview_ready');
assert.equal(genericFormRecord.artifactId, 'artifact-2');

// JSONL round-trip: the record must be a single JSON.stringify-able line with no circular refs.
const line = JSON.stringify(questionCardRecord);
assert.equal(JSON.parse(line).runId, 'fixture-run-questioncard');

console.log('persona-extraction tests passed');
