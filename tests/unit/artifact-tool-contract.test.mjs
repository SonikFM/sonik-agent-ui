import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const fixtureRoot = resolve(".omx/tmp/artifact-tool-contract-node");
const fixtureAppRoot = join(fixtureRoot, "apps/standalone-sveltekit/src/lib");
const repoRoot = process.cwd();

async function listTsFiles(dir) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

async function rewriteLocalTsImportsForNode(dir) {
  const files = await listTsFiles(dir);
  for (const file of files) {
    let source = await readFile(file, "utf8");
    source = source.replace(/from "(\.\.?\/[^".][^"]*)"/g, (match, specifier) => {
      const candidate = resolve(dirname(file), `${specifier}.ts`);
      return existsSync(candidate) ? `from "${specifier}.ts"` : match;
    });
    source = source.replace(/import\("(\.\.?\/[^".][^"]*)"\)/g, (match, specifier) => {
      const candidate = resolve(dirname(file), `${specifier}.ts`);
      return existsSync(candidate) ? `import("${specifier}.ts")` : match;
    });
    await writeFile(file, source);
  }
}


await rm(fixtureRoot, { recursive: true, force: true });
await mkdir(dirname(fixtureAppRoot), { recursive: true });
await cp(resolve("apps/standalone-sveltekit/src/lib"), fixtureAppRoot, { recursive: true });
await rewriteLocalTsImportsForNode(fixtureAppRoot);
await symlink(resolve("apps/standalone-sveltekit/node_modules"), join(fixtureRoot, "apps/standalone-sveltekit/node_modules"), "dir");
// tools/artifact.ts reaches into packages/json-ui-runtime/src (the shared
// spec-repair choke point) via a relative import; symlink the real packages
// dir into the fixture so that resolves the same way it does outside the sandbox.
await symlink(resolve("packages"), join(fixtureRoot, "packages"), "dir");

try {
  const artifactModuleUrl = new URL("./apps/standalone-sveltekit/src/lib/tools/artifact.ts", `file://${fixtureRoot}/`).href;
  const guidanceModuleUrl = new URL("./apps/standalone-sveltekit/src/lib/artifacts/artifact-generation-guidance.ts", `file://${fixtureRoot}/`).href;
  const { createJsonArtifact } = await import(artifactModuleUrl);
  const {
    JSON_ARTIFACT_STARTER_SPEC,
    JSON_ARTIFACT_DASHBOARD_SPEC,
    assertJsonArtifactGuidanceExamplesValid,
  } = await import(guidanceModuleUrl);

  assertJsonArtifactGuidanceExamplesValid();

  async function assertRejectsWithRetryGuidance(candidate, specificPattern, message) {
    await assert.rejects(
      () => createJsonArtifact.execute(candidate.data),
      (error) => {
        const text = error instanceof Error ? error.message : String(error);
        assert.match(text, /Invalid JSON-render artifact spec/, message);
        assert.match(text, /Retry once changing only invalid fields/, message);
        assert.match(text, /omit optional undefined props/, message);
        assert.match(text, /use exact allowed enum values/, message);
        assert.match(text, /preserve intended elements\/content\/actions/, message);
        if (specificPattern) assert.match(text, specificPattern, message);
        return true;
      },
      message,
    );
  }

  const validStarter = createJsonArtifact.inputSchema.safeParse({ title: "Starter", spec: JSON_ARTIFACT_STARTER_SPEC });
  assert.equal(validStarter.success, true, validStarter.success ? "" : JSON.stringify(validStarter.error.issues));

  const validDashboard = createJsonArtifact.inputSchema.safeParse({ title: "Dashboard", spec: JSON_ARTIFACT_DASHBOARD_SPEC });
  assert.equal(validDashboard.success, true, validDashboard.success ? "" : JSON.stringify(validDashboard.error.issues));

  const interactiveSetStateArtifact = {
    title: "Interactive",
    spec: {
      root: "main",
      elements: {
        main: {
          type: "Button",
          props: { label: "Save", variant: "default", size: "default", disabled: false },
          on: {
            press: {
              action: "setState",
              params: { statePath: "/saved", value: true },
            },
          },
          children: [],
        },
      },
      state: { saved: false },
    },
  };
  const validInteractive = createJsonArtifact.inputSchema.safeParse(interactiveSetStateArtifact);
  assert.equal(validInteractive.success, true, validInteractive.success ? "" : JSON.stringify(validInteractive.error.issues));
  const storedInteractive = await createJsonArtifact.execute(validInteractive.data);
  assert.deepEqual(
    storedInteractive.spec.elements.main.on,
    interactiveSetStateArtifact.spec.elements.main.on,
    "on.press setState binding must survive createJsonArtifact validation into the stored spec",
  );


  const bookingIntakeQuestionArtifact = {
    title: "Booking Context Intake",
    spec: {
      root: "main",
      elements: {
        main: {
          type: "Stack",
          props: { direction: "vertical", gap: "lg", wrap: null },
          children: ["header", "progress-bar", "question-card", "manifest-preview"],
        },
        header: {
          type: "Stack",
          props: { direction: "vertical", gap: "sm", wrap: null },
          children: ["title-heading", "description-text"],
        },
        "title-heading": { type: "Heading", props: { text: "Create Booking Context", level: "h1" }, children: [] },
        "description-text": {
          type: "Text",
          props: {
            content: "Collect the operational facts needed to draft a bookable venue schedule, resource, and service-period manifest.",
            muted: true,
          },
          children: [],
        },
        "progress-bar": {
          type: "Stack",
          props: { direction: "vertical", gap: "sm", wrap: null },
          children: ["progress-label", "progress"],
        },
        "progress-label": { type: "Text", props: { content: "Progress: 0 of 8 questions answered", muted: true }, children: [] },
        progress: { type: "Progress", props: { value: 0, max: 8 }, children: [] },
        "question-card": {
          type: "QuestionCard",
          props: {
            questionId: "q_intake_mode",
            title: "What are we configuring?",
            body: "Are we creating a recurring venue schedule, a one-time event, or a hybrid event with bookable sub-inventory?",
            whyThisMatters: "This controls which manifest fields and command previews become relevant later.",
            answerType: "choice_cards",
            choices: [
              { value: "venue_schedule", label: "Venue schedule", description: "Recurring inventory such as tee times, tables, rooms, classes, rentals, or reservations." },
              { value: "event", label: "Event", description: "A one-time event with a fixed date and time." },
              { value: "hybrid", label: "Hybrid", description: "An event that also has bookable sub-inventory." },
            ],
            required: true,
            allowSkip: false,
            writesTo: "/manifest/intakeMode",
            submitLabel: "Continue",
          },
          on: {
            submit: { action: "submitAnswer", params: { questionId: "q_intake_mode", value: { $state: "/draftAnswers/q_intake_mode" }, skipped: false, writesTo: "/manifest/intakeMode" } },
            skip: { action: "submitAnswer", params: { questionId: "q_intake_mode", value: { $state: "/draftAnswers/q_intake_mode" }, skipped: true, writesTo: "/manifest/intakeMode" } },
          },
          children: [],
        },
        "manifest-preview": { type: "ManifestPreview", props: { title: "Manifest draft", manifest: { $bindState: "/manifest" } }, children: [] },
      },
      state: { manifest: { intakeMode: "unknown" }, draftAnswers: { q_intake_mode: null } },
    },
  };
  const validBookingIntakeQuestion = createJsonArtifact.inputSchema.safeParse(bookingIntakeQuestionArtifact);
  assert.equal(validBookingIntakeQuestion.success, true, validBookingIntakeQuestion.success ? "" : JSON.stringify(validBookingIntakeQuestion.error.issues));
  const storedBookingIntakeQuestion = await createJsonArtifact.execute(validBookingIntakeQuestion.data);
  assert.deepEqual(storedBookingIntakeQuestion.spec.elements["question-card"].on, bookingIntakeQuestionArtifact.spec.elements["question-card"].on, "QuestionCard submit/skip bindings must survive createJsonArtifact validation");

  const validStringifiedBookingIntakeQuestion = createJsonArtifact.inputSchema.safeParse({
    title: "Booking Context Intake",
    spec: JSON.stringify(bookingIntakeQuestionArtifact.spec),
  });
  assert.equal(validStringifiedBookingIntakeQuestion.success, true, validStringifiedBookingIntakeQuestion.success ? "" : JSON.stringify(validStringifiedBookingIntakeQuestion.error.issues));
  const storedStringifiedBookingIntakeQuestion = await createJsonArtifact.execute(validStringifiedBookingIntakeQuestion.data);
  assert.equal(storedStringifiedBookingIntakeQuestion.spec.root, "main", "stringified spec tool input must parse into the same strict object spec");
  assert.deepEqual(storedStringifiedBookingIntakeQuestion.spec.elements["question-card"].on, bookingIntakeQuestionArtifact.spec.elements["question-card"].on, "stringified spec normalization must preserve QuestionCard bindings");

  const validFencedBookingIntakeQuestion = createJsonArtifact.inputSchema.safeParse({
    title: "Booking Context Intake",
    spec: `Here is the spec:
\`\`\`json
${JSON.stringify(bookingIntakeQuestionArtifact.spec)}
\`\`\``,
  });
  assert.equal(validFencedBookingIntakeQuestion.success, true, validFencedBookingIntakeQuestion.success ? "" : JSON.stringify(validFencedBookingIntakeQuestion.error.issues));
  const storedFencedBookingIntakeQuestion = await createJsonArtifact.execute(validFencedBookingIntakeQuestion.data);
  assert.equal(storedFencedBookingIntakeQuestion.spec.root, "main", "fenced/labeled string spec must parse into the same strict object spec");

  const doubleEncodedBookingIntakeQuestion = createJsonArtifact.inputSchema.safeParse({
    title: "Booking Context Intake",
    spec: JSON.stringify(JSON.stringify(bookingIntakeQuestionArtifact.spec)),
  });
  assert.equal(doubleEncodedBookingIntakeQuestion.success, true, doubleEncodedBookingIntakeQuestion.success ? "" : JSON.stringify(doubleEncodedBookingIntakeQuestion.error.issues));
  const storedDoubleEncodedBookingIntakeQuestion = await createJsonArtifact.execute(doubleEncodedBookingIntakeQuestion.data);
  assert.equal(storedDoubleEncodedBookingIntakeQuestion.spec.root, "main", "double-encoded string spec must parse into the same strict object spec");

  const unparseableBookingIntakeQuestion = createJsonArtifact.inputSchema.safeParse({
    title: "Venue Booking Setup",
    spec: "the canonical booking intake artifact",
  });
  assert.equal(unparseableBookingIntakeQuestion.success, true, unparseableBookingIntakeQuestion.success ? "" : JSON.stringify(unparseableBookingIntakeQuestion.error.issues));
  await assert.rejects(
    () => createJsonArtifact.execute(unparseableBookingIntakeQuestion.data),
    /Invalid JSON-render artifact spec/,
    "unparseable booking-intake spec strings must preserve failure evidence instead of silently promoting a canonical fallback",
  );

  const textOnlyQuestionCardArtifact = {
    title: "Venue Basics",
    spec: {
      root: "main",
      elements: {
        main: { type: "QuestionCard", props: { questionId: "venue-name", title: "Venue name", body: "What should guests see?", whyThisMatters: "Used in confirmations.", answerType: "short_text", required: true, submitLabel: "Save Name" }, children: [] },
      },
      state: {},
    },
  };
  const validTextOnlyQuestionCard = createJsonArtifact.inputSchema.safeParse(textOnlyQuestionCardArtifact);
  assert.equal(validTextOnlyQuestionCard.success, true, validTextOnlyQuestionCard.success ? "" : JSON.stringify(validTextOnlyQuestionCard.error.issues));
  const storedTextOnlyQuestionCard = await createJsonArtifact.execute(validTextOnlyQuestionCard.data);
  assert.equal(storedTextOnlyQuestionCard.spec.elements.main.type, "QuestionCard", "short_text QuestionCard without choices must pass execute-time catalog validation");

  const optionalUndefinedMetricArtifact = createJsonArtifact.inputSchema.safeParse({
    title: "Optional undefined metric",
    spec: {
      root: "main",
      elements: {
        main: {
          type: "Metric",
          props: {
            label: "Conversion",
            value: "0",
            detail: undefined,
            trend: undefined,
          },
          children: [],
        },
      },
      state: {},
    },
  });
  assert.equal(optionalUndefinedMetricArtifact.success, true, "tool input accepts optional undefined props before lossless repair");
  const storedOptionalUndefinedMetric = await createJsonArtifact.execute(optionalUndefinedMetricArtifact.data);
  const storedOptionalUndefinedMetricProps = storedOptionalUndefinedMetric.spec.elements.main.props;
  assert.equal(storedOptionalUndefinedMetricProps.label, "Conversion", "required Metric label should survive promotion");
  assert.equal(storedOptionalUndefinedMetricProps.value, "0", "falsy-looking Metric value should survive promotion");
  assert.equal(Object.prototype.hasOwnProperty.call(storedOptionalUndefinedMetricProps, "detail"), false, "optional undefined detail must be omitted in promoted spec");
  assert.equal(Object.prototype.hasOwnProperty.call(storedOptionalUndefinedMetricProps, "trend"), false, "optional undefined trend must be omitted in promoted spec");

  const validActionArray = createJsonArtifact.inputSchema.safeParse({
    title: "Interactive array",
    spec: {
      root: "main",
      elements: {
        main: {
          type: "Button",
          props: { label: "Save", variant: "default", size: "default", disabled: false },
          on: {
            press: [
              { action: "setState", params: { statePath: "/saved", value: true } },
              { action: "setState", params: { statePath: "/submitted", value: true } },
            ],
          },
          children: [],
        },
      },
      state: { saved: false, submitted: false },
    },
  });
  assert.equal(validActionArray.success, true, validActionArray.success ? "" : JSON.stringify(validActionArray.error.issues));
  const storedActionArray = await createJsonArtifact.execute(validActionArray.data);
  assert.equal(storedActionArray.spec.elements.main.on.press.length, 2, "action-array bindings must pass execute-time catalog validation and survive promotion");

  const arbitraryOnObject = createJsonArtifact.inputSchema.safeParse({
    title: "Bad",
    spec: {
      root: "main",
      elements: {
        main: {
          type: "Button",
          props: { label: "Bad", variant: "default", size: "default", disabled: false },
          on: { press: { arbitrary: true } },
          children: [],
        },
      },
      state: {},
    },
  });
  assert.equal(arbitraryOnObject.success, true, "tool input accepts model-shaped specs before strict execute-time validation");
  await assert.rejects(() => createJsonArtifact.execute(arbitraryOnObject.data), /Invalid JSON-render artifact spec/, "on.* values must be action objects or arrays before promotion");

  const emptyElements = createJsonArtifact.inputSchema.safeParse({ title: "Bad", spec: { root: "main", elements: {}, state: {} } });
  assert.equal(emptyElements.success, true, "tool input accepts model-shaped specs before strict execute-time validation");
  await assert.rejects(() => createJsonArtifact.execute(emptyElements.data), /Invalid JSON-render artifact spec/, "empty element maps must be rejected before promotion");

  const missingCardProps = createJsonArtifact.inputSchema.safeParse({ title: "Bad", spec: { root: "main", elements: { main: { type: "Card", props: {}, children: [] } }, state: {} } });
  assert.equal(missingCardProps.success, true, "tool input accepts model-shaped specs before strict execute-time validation");
  await assert.rejects(() => createJsonArtifact.execute(missingCardProps.data), /Invalid JSON-render artifact spec/, "catalog-derived props must reject empty Card props before promotion");

  const danglingChild = createJsonArtifact.inputSchema.safeParse({ title: "Bad", spec: { root: "main", elements: { main: { type: "Card", props: { title: "Bad", description: "Bad" }, children: ["missing"] } }, state: {} } });
  assert.equal(danglingChild.success, true, "tool input accepts model-shaped specs before strict execute-time validation");
  await assertRejectsWithRetryGuidance(
    danglingChild,
    /references child \"missing\" which does not exist/,
    "dangling child ids must remain invalid and produce actionable retry guidance instead of being pruned/promoted",
  );

  const invalidButtonEnumAndUndefined = createJsonArtifact.inputSchema.safeParse({
    title: "Bad enum",
    spec: {
      root: "main",
      elements: {
        main: {
          type: "Button",
          props: { label: "Save", variant: "primary", size: "default", disabled: undefined },
          children: [],
        },
      },
      state: {},
    },
  });
  assert.equal(invalidButtonEnumAndUndefined.success, true, "tool input accepts model-shaped specs before strict execute-time validation");
  await assertRejectsWithRetryGuidance(
    invalidButtonEnumAndUndefined,
    /variant: Invalid option/,
    "invalid enum values and observed Button disabled: undefined input must throw with retry guidance",
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

assert.equal(repoRoot, process.cwd(), "contract test should not change cwd");
console.log("artifact-tool-contract tests passed");
