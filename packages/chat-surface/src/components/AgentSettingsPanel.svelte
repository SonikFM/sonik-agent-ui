<script lang="ts">
  export type AgentToolPermissionMode = "off" | "ask" | "allow";

  export interface AgentSettingsModelOption {
    id: string;
    label: string;
    provider?: string;
    recommended?: boolean;
    description?: string;
    source?: "fallback" | "gateway";
    contextWindow?: number;
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
    supportsTools?: boolean;
    supportsImages?: boolean;
    supportsReasoning?: boolean;
    zdrStatus?: "available" | "unknown";
  }

  export interface AgentSettingsSkillOption {
    id: string;
    familyId?: string;
    label: string;
    description?: string;
    loadPolicy?: string;
  }

  export interface AgentSettingsCustomSkill {
    id: string;
    label: string;
    markdown: string;
    enabled: boolean;
  }

  export interface AgentSettingsToolFamily {
    id: string;
    label: string;
    description?: string;
    commandCount?: number;
    mode: AgentToolPermissionMode;
    disabledReason?: string;
  }

  export interface AgentSettingsContextItem {
    id: string;
    label: string;
    kind?: string;
  }

  export interface AgentSettingsAddon {
    id: string;
    label: string;
    status: "connected" | "available" | "needs_auth" | "disabled";
    description?: string;
    disabledReason?: string;
  }

  export interface AgentSettingsPanelProps {
    modelOptions: AgentSettingsModelOption[];
    selectedModelId: string;
    modelCatalogStatus?: "idle" | "loading" | "ready" | "fallback" | "error";
    modelCatalogMessage?: string | null;
    requireZdr?: boolean;
    skillOptions: AgentSettingsSkillOption[];
    enabledSkillIds: string[];
    customSkills?: AgentSettingsCustomSkill[];
    toolFamilies: AgentSettingsToolFamily[];
    contextItems?: AgentSettingsContextItem[];
    systemPrompt?: string;
    addons?: AgentSettingsAddon[];
    embedded?: boolean;
    onModelChange?: (modelId: string) => void;
    onModelCatalogRefresh?: () => void;
    onRequireZdrChange?: (required: boolean) => void;
    onSkillToggle?: (skillId: string, enabled: boolean) => void;
    onCustomSkillCreate?: (skill: { label: string; markdown: string }) => void;
    onCustomSkillUpdate?: (skillId: string, patch: Partial<Pick<AgentSettingsCustomSkill, "label" | "markdown" | "enabled">>) => void;
    onSystemPromptChange?: (prompt: string) => void;
    onToolPermissionChange?: (familyId: string, mode: AgentToolPermissionMode) => void;
  }

  let {
    modelOptions,
    selectedModelId,
    modelCatalogStatus = "idle",
    modelCatalogMessage = null,
    requireZdr = true,
    skillOptions,
    enabledSkillIds,
    customSkills = [],
    toolFamilies,
    contextItems = [],
    systemPrompt = "",
    addons = [],
    embedded = false,
    onModelChange,
    onModelCatalogRefresh,
    onRequireZdrChange,
    onSkillToggle,
    onCustomSkillCreate,
    onCustomSkillUpdate,
    onSystemPromptChange,
    onToolPermissionChange,
  }: AgentSettingsPanelProps = $props();

  const tabs = ["model", "skills", "tools", "context", "addons"] as const;
  type AgentSettingsTab = typeof tabs[number];

  let open = $state(false);
  let activeTab = $state<AgentSettingsTab>("model");
  let skillQuery = $state("");
  let toolQuery = $state("");
  let modelQuery = $state("");
  let draftSkillLabel = $state("");
  let draftSkillMarkdown = $state("");

  const enabledSkillSet = $derived(new Set(enabledSkillIds));
  const selectedModel = $derived(modelOptions.find((option) => option.id === selectedModelId));
  const filteredModels = $derived(modelOptions.filter((option) => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) return true;
    return [option.label, option.id, option.provider, option.description].filter(Boolean).join(" ").toLowerCase().includes(query);
  }).slice(0, 80));
  const filteredSkills = $derived(skillOptions.filter((skill) => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return true;
    return [skill.label, skill.id, skill.familyId, skill.description].filter(Boolean).join(" ").toLowerCase().includes(query);
  }));
  const filteredCustomSkills = $derived(customSkills.filter((skill) => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return true;
    return [skill.label, skill.id, skill.markdown].filter(Boolean).join(" ").toLowerCase().includes(query);
  }));
  const filteredToolFamilies = $derived(toolFamilies.filter((family) => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return true;
    return [family.label, family.id, family.description].filter(Boolean).join(" ").toLowerCase().includes(query);
  }));

  function chooseTab(tab: string): void {
    if ((tabs as readonly string[]).includes(tab)) activeTab = tab as AgentSettingsTab;
  }

  function formatContextWindow(value: number | undefined): string {
    if (!value) return "context unknown";
    if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M context`;
    if (value >= 1_000) return `${Math.round(value / 1_000)}K context`;
    return `${value} context`;
  }

  function formatPrice(value: number | undefined): string | null {
    if (typeof value !== "number") return null;
    return `$${value.toFixed(value < 1 ? 2 : 1)}/1M`;
  }

  function submitCustomSkill(): void {
    const label = draftSkillLabel.trim();
    const markdown = draftSkillMarkdown.trim();
    if (!label || !markdown) return;
    onCustomSkillCreate?.({ label, markdown });
    draftSkillLabel = "";
    draftSkillMarkdown = "";
  }

  function permissionTone(mode: AgentToolPermissionMode): string {
    if (mode === "allow") return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
    if (mode === "off") return "bg-muted text-muted-foreground border-border";
    return "bg-amber-500/10 text-amber-700 border-amber-500/30";
  }
</script>

<div class="relative">
  <button
    type="button"
    class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-label="Agent settings"
    aria-haspopup="dialog"
    aria-expanded={open}
    data-testid="agent-settings-gear"
    onclick={() => { open = true; }}
  >
    <span aria-hidden="true">⚙</span>
    <span class="hidden sm:inline">Agent</span>
  </button>

  {#if open}
    <div class="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm" role="presentation" onclick={() => { open = false; }}></div>
    <div
      class="fixed right-4 top-4 z-50 flex max-h-[calc(100vh-2rem)] w-[min(760px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Agent settings"
      data-testid="agent-settings-panel"
    >
      <header class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agent controls</p>
          <h2 class="text-lg font-semibold text-foreground">Settings</h2>
          <p class="mt-1 max-w-[70ch] text-sm text-muted-foreground">Configure this run without exceeding host grants. Mutating commands still require trusted context and receipts.</p>
        </div>
        <button type="button" class="rounded-full border border-border px-3 py-1 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={() => { open = false; }}>Close</button>
      </header>

      <div class="grid min-h-0 flex-1 grid-cols-[168px_minmax(0,1fr)]">
        <nav class="border-r border-border bg-muted/30 p-3 text-sm" aria-label="Agent settings sections">
          {#each tabs as tab (tab)}
            <button
              type="button"
              class="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left capitalize transition-colors {activeTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'}"
              aria-current={activeTab === tab ? "page" : undefined}
              onclick={() => chooseTab(tab)}
            >
              <span>{tab === "model" ? "Models" : tab}</span>
              {#if tab === "skills" && (enabledSkillIds.length + customSkills.filter((skill) => skill.enabled).length) > 0}<span class="text-xs">{enabledSkillIds.length + customSkills.filter((skill) => skill.enabled).length}</span>{/if}
            </button>
          {/each}
        </nav>

        <div class="min-h-0 overflow-auto p-5">
          {#if activeTab === "model"}
            <section class="space-y-4" aria-labelledby="agent-model-heading">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="agent-model-heading" class="font-semibold text-foreground">Model picker</h3>
                  <p class="text-sm text-muted-foreground">Loaded from Vercel AI Gateway when available. ZDR is enforced by Gateway policy/request options, not exposed as model-list metadata.</p>
                </div>
                <button type="button" class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={() => onModelCatalogRefresh?.()}>
                  {modelCatalogStatus === "loading" ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              <label class="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3">
                <input class="mt-1" type="checkbox" checked={requireZdr} onchange={(event) => onRequireZdrChange?.((event.currentTarget as HTMLInputElement).checked)} />
                <span>
                  <span class="block font-medium text-foreground">Require zero-data-retention routing</span>
                  <span class="block text-sm text-muted-foreground">When enabled, Gateway is asked to route only through ZDR-compliant providers. The catalog endpoint does not list per-model ZDR metadata.</span>
                </span>
              </label>
              <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span class="rounded-full border border-border px-2 py-1">Catalog: {modelCatalogStatus}</span>
                {#if selectedModel}<span class="rounded-full border border-border px-2 py-1">Selected: {selectedModel.id}</span>{/if}
                {#if modelCatalogMessage}<span>{modelCatalogMessage}</span>{/if}
              </div>
              <input class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Search Gateway models" bind:value={modelQuery} aria-label="Search Gateway models" />
              <div class="divide-y divide-border rounded-xl border border-border bg-background/60">
                {#each filteredModels as option (option.id)}
                  <button
                    type="button"
                    class="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {selectedModelId === option.id ? 'bg-accent/35' : ''}"
                    aria-pressed={selectedModelId === option.id}
                    onclick={() => onModelChange?.(option.id)}
                  >
                    <span class="mt-1 h-3 w-3 rounded-full border border-border {selectedModelId === option.id ? 'bg-primary' : 'bg-background'}" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1">
                      <span class="flex flex-wrap items-center gap-2">
                        <span class="font-medium text-foreground">{option.label}</span>
                        {#if option.recommended}<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Recommended</span>{/if}
                        <span class="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{option.source ?? "gateway"}</span>
                      </span>
                      <span class="mt-1 block text-xs text-muted-foreground">{option.provider ?? "Gateway"} · {option.id} · {formatContextWindow(option.contextWindow)}</span>
                      <span class="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {#if option.supportsTools}<span>tool-use</span>{/if}
                        {#if option.supportsReasoning}<span>reasoning</span>{/if}
                        {#if option.supportsImages}<span>vision</span>{/if}
                        {#if formatPrice(option.inputPricePerMillion)}<span>in {formatPrice(option.inputPricePerMillion)}</span>{/if}
                        {#if formatPrice(option.outputPricePerMillion)}<span>out {formatPrice(option.outputPricePerMillion)}</span>{/if}
                      </span>
                    </span>
                  </button>
                {/each}
              </div>
            </section>
          {:else if activeTab === "skills"}
            <section class="space-y-4" aria-labelledby="agent-skills-heading">
              <div>
                <h3 id="agent-skills-heading" class="font-semibold text-foreground">Skills</h3>
                <p class="text-sm text-muted-foreground">Load runtime skills or draft a Markdown skill for this session. Custom skills are prompt context, not installed global skills.</p>
              </div>
              <input class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Search skills" bind:value={skillQuery} aria-label="Search skills" />
              <div class="rounded-xl border border-border bg-background/60">
                <div class="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Installed runtime skills</div>
                {#each filteredSkills as skill (skill.id)}
                  <div class="flex items-start justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
                    <div class="min-w-0">
                      <p class="font-medium text-foreground">{skill.label}</p>
                      <p class="text-xs text-muted-foreground">{skill.id}{skill.familyId ? ` · ${skill.familyId}` : ""}{skill.loadPolicy ? ` · ${skill.loadPolicy}` : ""}</p>
                      {#if skill.description}<p class="mt-1 text-sm text-muted-foreground">{skill.description}</p>{/if}
                    </div>
                    <button
                      type="button"
                      class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {enabledSkillSet.has(skill.id) ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}"
                      aria-pressed={enabledSkillSet.has(skill.id)}
                      onclick={() => onSkillToggle?.(skill.id, !enabledSkillSet.has(skill.id))}
                    >{enabledSkillSet.has(skill.id) ? "Loaded" : "Load"}</button>
                  </div>
                {/each}
              </div>
              <div class="rounded-xl border border-border bg-background/60 p-4">
                <h4 class="font-medium text-foreground">Create a Markdown skill</h4>
                <p class="mt-1 text-sm text-muted-foreground">Temporary session skill. Rich text editing can replace this textarea later.</p>
                <input class="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Skill name" bind:value={draftSkillLabel} aria-label="Custom skill name" />
                <textarea class="mt-3 min-h-32 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Write Markdown instructions for this agent run…" bind:value={draftSkillMarkdown} aria-label="Custom skill Markdown"></textarea>
                <button type="button" class="mt-3 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={!draftSkillLabel.trim() || !draftSkillMarkdown.trim()} aria-describedby="custom-skill-create-reason" title={!draftSkillLabel.trim() || !draftSkillMarkdown.trim() ? "Add both a skill name and Markdown instructions before creating a session skill." : undefined} onclick={submitCustomSkill}>Create skill</button>
                {#if !draftSkillLabel.trim() || !draftSkillMarkdown.trim()}
                  <p id="custom-skill-create-reason" class="mt-2 text-xs text-muted-foreground">Add both a skill name and Markdown instructions to enable creation.</p>
                {/if}
              </div>
              {#if filteredCustomSkills.length > 0}
                <div class="rounded-xl border border-border bg-background/60">
                  <div class="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Session Markdown skills</div>
                  {#each filteredCustomSkills as skill (skill.id)}
                    <div class="border-b border-border p-4 last:border-b-0">
                      <div class="flex items-center justify-between gap-3">
                        <input class="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium" value={skill.label} aria-label={`Edit ${skill.label} label`} oninput={(event) => onCustomSkillUpdate?.(skill.id, { label: (event.currentTarget as HTMLInputElement).value })} />
                        <button type="button" class="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent" aria-pressed={skill.enabled} onclick={() => onCustomSkillUpdate?.(skill.id, { enabled: !skill.enabled })}>{skill.enabled ? "Loaded" : "Off"}</button>
                      </div>
                      <p class="mt-1 text-xs text-muted-foreground">{skill.id}</p>
                      <textarea class="mt-3 min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={skill.markdown} aria-label={`Edit ${skill.label} Markdown`} oninput={(event) => onCustomSkillUpdate?.(skill.id, { markdown: (event.currentTarget as HTMLTextAreaElement).value })}></textarea>
                    </div>
                  {/each}
                </div>
              {/if}
            </section>
          {:else if activeTab === "tools"}
            <section class="space-y-4" aria-labelledby="agent-tools-heading">
              <div>
                <h3 id="agent-tools-heading" class="font-semibold text-foreground">Tool permissions</h3>
                <p class="text-sm text-muted-foreground">Off hides a family. Ask is the safe default. Allow reduces friction but never bypasses signed host approvals.</p>
              </div>
              <input class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Search tool families" bind:value={toolQuery} aria-label="Search tool families" />
              <div class="divide-y divide-border rounded-xl border border-border bg-background/60">
                {#each filteredToolFamilies as family (family.id)}
                  <article class="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <h4 class="font-medium text-foreground">{family.label}</h4>
                        <span class="rounded-full border px-2 py-0.5 text-xs {permissionTone(family.mode)}">{family.mode}</span>
                      </div>
                      <p class="text-xs text-muted-foreground">{family.id}{family.commandCount ? ` · ${family.commandCount} commands` : ""}</p>
                      {#if family.description}<p class="mt-1 text-sm text-muted-foreground">{family.description}</p>{/if}
                      {#if family.disabledReason}<p class="mt-1 text-xs text-muted-foreground">Unavailable: {family.disabledReason}</p>{/if}
                    </div>
                    <div class="inline-flex rounded-lg border border-border bg-background p-1" role="group" aria-label={`Permission for ${family.label}`}>
                      {#each ["off", "ask", "allow"] as mode (mode)}
                        <button type="button" class="rounded-md px-3 py-1 text-sm capitalize transition-colors {family.mode === mode ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}" aria-pressed={family.mode === mode} onclick={() => onToolPermissionChange?.(family.id, mode as AgentToolPermissionMode)}>{mode}</button>
                      {/each}
                    </div>
                  </article>
                {/each}
              </div>
            </section>
          {:else if activeTab === "context"}
            <section class="space-y-4" aria-labelledby="agent-context-heading">
              <div>
                <h3 id="agent-context-heading" class="font-semibold text-foreground">Context and prompt</h3>
                <p class="text-sm text-muted-foreground">Host context is read-only. Add user instructions here for the next run without changing the host grant boundary.</p>
              </div>
              <label class="block">
                <span class="text-sm font-medium text-foreground">Additional system prompt</span>
                <textarea class="mt-2 min-h-32 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Add temporary agent instructions for this session…" value={systemPrompt} oninput={(event) => onSystemPromptChange?.((event.currentTarget as HTMLTextAreaElement).value)}></textarea>
              </label>
              <div class="rounded-xl border border-border bg-background/60">
                <div class="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Attached context</div>
                {#if contextItems.length === 0}
                  <p class="p-4 text-sm text-muted-foreground">No page/document context is attached. Use composer chips or host page context to add context.</p>
                {:else}
                  {#each contextItems as item (item.id)}
                    <div class="border-b border-border px-4 py-3 last:border-b-0">
                      <p class="font-medium text-foreground">{item.label}</p>
                      <p class="text-xs text-muted-foreground">{item.kind ?? "context"} · {item.id}</p>
                    </div>
                  {/each}
                {/if}
              </div>
            </section>
          {:else}
            <section class="space-y-3" aria-labelledby="agent-addons-heading">
              <div>
                <h3 id="agent-addons-heading" class="font-semibold text-foreground">Add-ons</h3>
                <p class="text-sm text-muted-foreground">Coming soon. Add-ons will use the same off/ask/allow permission model, with connection scopes controlled by your workspace.</p>
              </div>
              {#each (addons.length ? addons : [{ id: 'mcp-placeholder', label: 'Connectors', status: 'pending', description: 'Connector installation is coming soon to this workspace.', disabledReason: 'Add-ons are not available yet.' }]) as addon (addon.id)}
                <article class="rounded-xl border border-border bg-background/60 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <h4 class="font-medium text-foreground">{addon.label}</h4>
                    <span class="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{addon.status}</span>
                  </div>
                  {#if addon.description}<p class="mt-1 text-sm text-muted-foreground">{addon.description}</p>{/if}
                  {#if addon.disabledReason}<p class="mt-1 text-xs text-muted-foreground">Unavailable: {addon.disabledReason}</p>{/if}
                </article>
              {/each}
            </section>
          {/if}
        </div>
      </div>

      <footer class="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        {embedded ? "Embedded mode: host session, page context, and approvals are authoritative." : "Standalone mode: host-specific commands may be unavailable without signed context."}
      </footer>
    </div>
  {/if}
</div>
