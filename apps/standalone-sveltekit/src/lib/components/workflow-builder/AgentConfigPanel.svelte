<script lang="ts">
  // Phase 5 (agent-creation-tool-plan-2026-07-13.md, B1): Orchestrate-class
  // agent-definition config panel -- name/title, model picker, ordered
  // prompt-module editor, tool-scoping drill-down (family -> per-command
  // rows), knowledge attach. Every field writes directly onto the bindable
  // `definition`; the parent (WorkflowBuilderRoot) owns save/publish and
  // D016 schema validation -- this panel never calls the API itself.
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import * as Accordion from "$lib/components/ui/accordion";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import { Separator } from "$lib/components/ui/separator";
  import { AGENT_MODEL_OPTIONS, DEFAULT_AGENT_MODEL_ID, MAX_AGENT_PROMPT_OVERRIDE_CHARS, type AgentModelOption, type AgentToolPermissionMode } from "$lib/agent-settings";
  import { AGENT_PROMPT_MODULES, CORE_MODULE_ID } from "$lib/agent-prompt";
  import { groupCapabilitiesByFamily, effectiveFamilyMode, type KnowledgeRef } from "./builder-model";
  import { isModelIncompatible } from "./builder-model";
  import { formatModelContextWindow } from "./builder-model";
  import { COLLAPSED_MODEL_ROW_LIMIT, filterCatalogModels, modelCapabilityBadges, modelDisabledReason, type CatalogModelOption } from "./organizer-model";
  import type { AgentDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
  import type { CapabilityReadiness } from "@sonik-agent-ui/tool-contracts/workflow-vnext";

  interface Props {
    definition: AgentDefinition;
    validationIssues?: string[];
    modelOptions?: AgentModelOption[];
    modelCatalogStatus?: "idle" | "loading" | "ready" | "fallback" | "error";
    modelCatalogMessage?: string | null;
    onModelCatalogRefresh?: () => void;
    capabilityReadiness?: CapabilityReadiness[];
  }
  let {
    definition = $bindable(),
    validationIssues = [],
    modelOptions = AGENT_MODEL_OPTIONS,
    modelCatalogStatus = "idle",
    modelCatalogMessage = null,
    onModelCatalogRefresh,
    capabilityReadiness = [],
  }: Props = $props();

  const TOOL_MODES: AgentToolPermissionMode[] = ["off", "ask", "allow"];
  const capabilityFamilies = groupCapabilitiesByFamily();
  const readinessById = $derived(new Map(capabilityReadiness.map((entry) => [entry.capabilityId, entry])));

  let expandedFamilyIds = $state<string[]>([]);
  let modelQuery = $state("");
  let modelCatalogExpanded = $state(false);
  const filteredModelOptions = $derived(filterCatalogModels(modelOptions as CatalogModelOption[], modelQuery));
  const selectedModelLabel = $derived(modelOptions.find((option) => option.id === definition.modelPolicy?.modelId)?.label ?? "No model selected");

  function handleModelListKeydown(event: KeyboardEvent): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="option"]:not([aria-disabled="true"])')];
    if (options.length === 0) return;
    event.preventDefault();
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : event.key === "ArrowDown"
          ? Math.min(current + 1, options.length - 1)
          : Math.max(current - 1, 0);
    options[next]?.focus();
  }

  function setTitle(value: string): void {
    definition = { ...definition, title: value };
  }

  function setModel(modelId: string): void {
    if (!modelId) return;
    definition = { ...definition, modelPolicy: { modelId, requireZdr: definition.modelPolicy?.requireZdr ?? false } };
  }

  function setRequireZdr(requireZdr: boolean): void {
    const modelId = definition.modelPolicy?.modelId ?? DEFAULT_AGENT_MODEL_ID;
    definition = { ...definition, modelPolicy: { modelId, requireZdr } };
  }

  function setFamilyMode(familyId: string, mode: AgentToolPermissionMode): void {
    if (mode !== "off" && familyDisabledReason(familyId)) return;
    definition = { ...definition, toolPolicy: { ...definition.toolPolicy, [familyId]: mode } };
  }

  function familyDisabledReason(familyId: string): string | null {
    if (capabilityReadiness.length === 0) return null;
    const blocked = capabilityFamilies
      .find((family) => family.familyId === familyId)
      ?.capabilities.map((capability) => readinessById.get(capability.capabilityId))
      .filter((readiness) => readiness && !readiness.callable) ?? [];
    return blocked.length > 0 ? `Not runnable: ${[...new Set(blocked.flatMap((readiness) => readiness?.reasonCodes ?? []))].join(", ")}` : null;
  }

  const availableModuleIds = $derived(
    [CORE_MODULE_ID, ...AGENT_PROMPT_MODULES.map((module) => module.id)].filter(
      (id) => !definition.promptModules.moduleIds.includes(id),
    ),
  );

  function moduleTitle(moduleId: string): string {
    if (moduleId === CORE_MODULE_ID) return "Core (always-on identity / safety / rendering rules)";
    return AGENT_PROMPT_MODULES.find((module) => module.id === moduleId)?.title ?? moduleId;
  }

  function addPromptModule(moduleId: string): void {
    if (!moduleId || definition.promptModules.moduleIds.includes(moduleId)) return;
    definition = {
      ...definition,
      promptModules: { ...definition.promptModules, moduleIds: [...definition.promptModules.moduleIds, moduleId] },
    };
  }

  function removePromptModule(moduleId: string): void {
    const overrides = { ...definition.promptModules.overrides };
    delete overrides[moduleId];
    definition = {
      ...definition,
      promptModules: { moduleIds: definition.promptModules.moduleIds.filter((id) => id !== moduleId), overrides },
    };
  }

  function moveModule(moduleId: string, direction: -1 | 1): void {
    const ids = [...definition.promptModules.moduleIds];
    const index = ids.indexOf(moduleId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    definition = { ...definition, promptModules: { ...definition.promptModules, moduleIds: ids } };
  }

  function setModuleOverride(moduleId: string, body: string): void {
    definition = {
      ...definition,
      promptModules: { ...definition.promptModules, overrides: { ...definition.promptModules.overrides, [moduleId]: body.slice(0, MAX_AGENT_PROMPT_OVERRIDE_CHARS) } },
    };
  }

  let knowledgeStoreIdDraft = $state("");
  let knowledgeTitleDraft = $state("");

  function attachKnowledgeRef(): void {
    const storeId = knowledgeStoreIdDraft.trim();
    const title = knowledgeTitleDraft.trim();
    if (!storeId || !title || definition.knowledgeRefs.some((ref) => ref.storeId === storeId)) return;
    const ref: KnowledgeRef = { storeId, title, fileRefs: [], readable: true };
    definition = { ...definition, knowledgeRefs: [...definition.knowledgeRefs, ref] };
    knowledgeStoreIdDraft = "";
    knowledgeTitleDraft = "";
  }

  function removeKnowledgeRef(storeId: string): void {
    definition = { ...definition, knowledgeRefs: definition.knowledgeRefs.filter((ref) => ref.storeId !== storeId) };
  }
</script>

<div class="flex flex-col gap-4" data-agent-panel="workflow-builder-config">
  {#if validationIssues.length > 0}
    <Card.Root class="border-destructive/50">
      <Card.Content class="flex flex-col gap-1 pt-4 text-sm text-destructive">
        {#each validationIssues as issue (issue)}
          <span>{issue}</span>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>Identity</Card.Title>
      <Card.Description>Agent id and display title for the published definition.</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      <div class="flex flex-col gap-2">
        <Label for="builder-agent-id">Agent id</Label>
        <Input id="builder-agent-id" value={definition.agentId} disabled aria-label="Agent id" />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="builder-agent-title">Title</Label>
        <Input
          id="builder-agent-title"
          value={definition.title}
          oninput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)}
          aria-label="Agent title"
        />
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Model</Card.Title>
      <Card.Description>Pins the runtime model this definition resolves to (agent-runtime-adapter.ts modelPolicy mapping).</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">Catalog: {modelCatalogStatus}</Badge>
        {#if modelCatalogMessage}
          <span role={modelCatalogStatus === "error" ? "alert" : "status"}>{modelCatalogMessage}</span>
        {/if}
        <Button variant="ghost" size="sm" onclick={() => onModelCatalogRefresh?.()}>
          {modelCatalogStatus === "loading" ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      <Input placeholder="Search models" bind:value={modelQuery} aria-label="Search models" />
      <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{filteredModelOptions.length} {filteredModelOptions.length === 1 ? "result" : "results"}</span>
        <span class="sr-only" role="status" aria-live="polite">{filteredModelOptions.length} model results available.</span>
        <span class="sr-only" role="status" aria-live="polite">Selected model: {selectedModelLabel}.</span>
        {#if filteredModelOptions.length > COLLAPSED_MODEL_ROW_LIMIT}
          <Button variant="ghost" size="sm" onclick={() => modelCatalogExpanded = !modelCatalogExpanded} aria-expanded={modelCatalogExpanded}>
            {modelCatalogExpanded ? "Collapse catalog" : "Expand catalog"}
          </Button>
        {/if}
      </div>
      <div
        class="flex flex-col divide-y divide-border overflow-y-auto rounded-md ring-1 ring-border {modelCatalogExpanded ? 'max-h-none' : 'max-h-[50rem]'}"
        role="listbox"
        aria-label="Model"
        tabindex="0"
        onkeydown={handleModelListKeydown}
      >
        {#each filteredModelOptions as option (option.id)}
          {@const disabledReason = modelDisabledReason(isModelIncompatible(definition, option), option as CatalogModelOption)}
          {@const selected = (definition.modelPolicy?.modelId ?? "") === option.id}
          <button
            type="button"
            class="flex h-20 shrink-0 items-start justify-between gap-3 overflow-hidden p-2 text-left text-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {selected ? 'bg-accent/30' : ''}"
            role="option"
            aria-selected={selected}
            aria-disabled={Boolean(disabledReason)}
            title={disabledReason ?? undefined}
            onclick={() => disabledReason ? undefined : setModel(option.id)}
          >
            <span class="flex min-w-0 flex-col gap-1">
              <span class="flex flex-wrap items-center gap-2">
                <span class="font-medium">{option.label}</span>
                <span class="text-xs text-muted-foreground">{option.provider}</span>
                {#if option.recommended}<Badge variant="secondary">Recommended</Badge>{/if}
                {#each modelCapabilityBadges(option as CatalogModelOption) as badge (badge)}
                  <Badge variant="outline">{badge}</Badge>
                {/each}
              </span>
              <span class="text-xs text-muted-foreground">{option.id} &middot; {formatModelContextWindow(option.contextWindow)}</span>
              {#if disabledReason}<span class="text-xs text-destructive">{disabledReason}</span>{/if}
            </span>
          </button>
        {:else}
          <p class="p-3 text-sm text-muted-foreground">No models match &ldquo;{modelQuery}&rdquo;.</p>
        {/each}
      </div>
      <label class="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={definition.modelPolicy?.requireZdr ?? false}
          onchange={(event) => setRequireZdr((event.currentTarget as HTMLInputElement).checked)}
        />
        Require zero-data-retention model only
      </label>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Prompt modules</Card.Title>
      <Card.Description>Ordered composition (agentPromptModulesSchema.moduleIds) with optional per-module overrides. An empty override suppresses that module for this run.</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      {#each definition.promptModules.moduleIds as moduleId, index (moduleId)}
        <div class="flex flex-col gap-2 rounded-md border border-border p-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium">{moduleTitle(moduleId)}</span>
            <div class="flex items-center gap-1">
              <Button variant="ghost" size="sm" disabled={index === 0} onclick={() => moveModule(moduleId, -1)} aria-label="Move {moduleId} up">Up</Button>
              <Button variant="ghost" size="sm" disabled={index === definition.promptModules.moduleIds.length - 1} onclick={() => moveModule(moduleId, 1)} aria-label="Move {moduleId} down">Down</Button>
              <Button variant="ghost" size="sm" onclick={() => removePromptModule(moduleId)} aria-label="Remove {moduleId}">Remove</Button>
            </div>
          </div>
          <textarea
            class="min-h-16 w-full rounded-md border border-input bg-background p-2 text-sm"
            placeholder="Override body (empty suppresses this module for this run)"
            value={definition.promptModules.overrides[moduleId] ?? ""}
            oninput={(event) => setModuleOverride(moduleId, (event.currentTarget as HTMLTextAreaElement).value)}
            aria-label="{moduleId} override"
          ></textarea>
        </div>
      {/each}
      {#if availableModuleIds.length > 0}
        <Select.Root type="single" value="" onValueChange={(value) => addPromptModule(value ?? "")}>
          <Select.Trigger aria-label="Add prompt module">Add module&hellip;</Select.Trigger>
          <Select.Content>
            {#each availableModuleIds as moduleId (moduleId)}
              <Select.Item value={moduleId}>{moduleTitle(moduleId)}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Tool scoping</Card.Title>
      <Card.Description>Family &rarr; per-command rows from the generated capability registry (115 capabilities). This panel reflects `toolPolicy` grants; it never issues them -- enforcement lives in command-catalog.ts's registry-live pin.</Card.Description>
    </Card.Header>
    <Card.Content>
      <Accordion.Root type="multiple" bind:value={expandedFamilyIds} class="w-full">
        {#each capabilityFamilies as family (family.familyId)}
          {@const policyDisabledReason = familyDisabledReason(family.familyId)}
          <Accordion.Item value={family.familyId}>
            <Accordion.Trigger>
              <span class="flex flex-1 items-center justify-between gap-3 pr-2">
                <span class="flex items-center gap-2">
                  <span class="font-mono text-sm">{family.familyId}</span>
                  <Badge variant="outline">{family.capabilities.length} command{family.capabilities.length === 1 ? "" : "s"}</Badge>
                </span>
                <Badge variant={effectiveFamilyMode(definition, family.familyId) === "off" ? "secondary" : "default"}>
                  {effectiveFamilyMode(definition, family.familyId)}
                </Badge>
              </span>
            </Accordion.Trigger>
            <Accordion.Content>
              <div class="flex flex-col gap-3">
                <Select.Root type="single" value={effectiveFamilyMode(definition, family.familyId)} onValueChange={(value) => setFamilyMode(family.familyId, (value ?? "off") as AgentToolPermissionMode)}>
                  <Select.Trigger aria-label="{family.familyId} tool policy">{effectiveFamilyMode(definition, family.familyId)}</Select.Trigger>
                  <Select.Content>
                    {#each TOOL_MODES as mode (mode)}
                      <Select.Item value={mode} disabled={mode !== "off" && Boolean(policyDisabledReason)}>{mode}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                {#if policyDisabledReason}<p class="text-xs text-destructive" role="status">{policyDisabledReason}</p>{/if}
                <Separator />
                <div class="flex flex-col gap-1">
                  {#each family.capabilities as capability (capability.capabilityId)}
                    {@const readiness = readinessById.get(capability.capabilityId)}
                    <div class="flex items-center justify-between gap-2 text-sm">
                      <span class="font-mono text-xs text-muted-foreground">{capability.capabilityId}</span>
                      <span class="flex items-center gap-2">
                        <Badge variant="outline">{capability.effect}</Badge>
                        <Badge variant={readiness?.callable ? "default" : "secondary"} title={readiness?.reasonCodes.join(", ") ?? "Server readiness unavailable"}>
                          {readiness?.callable ? "callable" : readiness?.nextAction ?? "unavailable"}
                        </Badge>
                        {#if readiness && !readiness.callable}<span class="sr-only">Blocked: {readiness.reasonCodes.join(", ")}</span>{/if}
                        <span class="text-xs text-muted-foreground">inherits {effectiveFamilyMode(definition, family.familyId)}</span>
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Knowledge attach</Card.Title>
      <Card.Description>Attaches file-based Knowledge v1 stores (readable-file inclusion into prompt context, no vectors).</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      {#each definition.knowledgeRefs as ref (ref.storeId)}
        <div class="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
          <span>{ref.title} <span class="font-mono text-xs text-muted-foreground">({ref.storeId})</span></span>
          <Button variant="ghost" size="sm" onclick={() => removeKnowledgeRef(ref.storeId)} aria-label="Detach {ref.storeId}">Detach</Button>
        </div>
      {/each}
      <div class="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Store id" bind:value={knowledgeStoreIdDraft} aria-label="Knowledge store id" />
        <Input placeholder="Title" bind:value={knowledgeTitleDraft} aria-label="Knowledge store title" />
        <Button variant="secondary" onclick={attachKnowledgeRef} disabled={!knowledgeStoreIdDraft.trim() || !knowledgeTitleDraft.trim()}>Attach</Button>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled
        title="Knowledge store creation UI is stubbed for now -- wire to the store API in a later slice"
      >
        Create new store&hellip;
      </Button>
    </Card.Content>
  </Card.Root>
</div>
