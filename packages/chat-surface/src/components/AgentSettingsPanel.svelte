<script lang="ts">
  export type AgentToolPermissionMode = "off" | "ask" | "allow";

  export interface AgentSettingsModelOption {
    id: string;
    label: string;
    provider?: string;
    recommended?: boolean;
    description?: string;
  }

  export interface AgentSettingsSkillOption {
    id: string;
    familyId?: string;
    label: string;
    description?: string;
    loadPolicy?: string;
  }

  export interface AgentSettingsToolFamily {
    id: string;
    label: string;
    description?: string;
    commandCount?: number;
    mode: AgentToolPermissionMode;
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
  }

  export interface AgentSettingsPanelProps {
    modelOptions: AgentSettingsModelOption[];
    selectedModelId: string;
    skillOptions: AgentSettingsSkillOption[];
    enabledSkillIds: string[];
    toolFamilies: AgentSettingsToolFamily[];
    contextItems?: AgentSettingsContextItem[];
    addons?: AgentSettingsAddon[];
    embedded?: boolean;
    onModelChange?: (modelId: string) => void;
    onSkillToggle?: (skillId: string, enabled: boolean) => void;
    onToolPermissionChange?: (familyId: string, mode: AgentToolPermissionMode) => void;
  }

  let {
    modelOptions,
    selectedModelId,
    skillOptions,
    enabledSkillIds,
    toolFamilies,
    contextItems = [],
    addons = [],
    embedded = false,
    onModelChange,
    onSkillToggle,
    onToolPermissionChange,
  }: AgentSettingsPanelProps = $props();

  let open = $state(false);
  let activeTab = $state<"model" | "skills" | "tools" | "context" | "addons">("model");
  let skillQuery = $state("");
  let toolQuery = $state("");

  const enabledSkillSet = $derived(new Set(enabledSkillIds));
  const filteredSkills = $derived(skillOptions.filter((skill) => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return true;
    return [skill.label, skill.id, skill.familyId, skill.description].filter(Boolean).join(" ").toLowerCase().includes(query);
  }));
  const filteredToolFamilies = $derived(toolFamilies.filter((family) => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return true;
    return [family.label, family.id, family.description].filter(Boolean).join(" ").toLowerCase().includes(query);
  }));

  function handleModelSelect(event: Event): void {
    const target = event.currentTarget as HTMLSelectElement;
    onModelChange?.(target.value);
  }

  function toggleSkill(skillId: string, event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    onSkillToggle?.(skillId, target.checked);
  }

  function changePermission(familyId: string, event: Event): void {
    const target = event.currentTarget as HTMLSelectElement;
    onToolPermissionChange?.(familyId, target.value as AgentToolPermissionMode);
  }
</script>

<div class="relative">
  <button
    type="button"
    class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
    <div class="fixed inset-0 z-50 bg-background/45 backdrop-blur-sm" role="presentation" onclick={() => { open = false; }}></div>
    <div
      class="fixed right-4 top-4 z-50 flex max-h-[calc(100vh-2rem)] w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Agent settings"
      data-testid="agent-settings-panel"
    >
      <header class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Agent controls</p>
          <h2 class="text-lg font-semibold text-foreground">Settings</h2>
          <p class="mt-1 text-sm text-muted-foreground">Host grants remain the ceiling; this panel only narrows or selects runtime behavior.</p>
        </div>
        <button type="button" class="rounded-full border border-border px-3 py-1 text-sm hover:bg-accent" onclick={() => { open = false; }}>Close</button>
      </header>

      <nav class="grid grid-cols-5 border-b border-border text-sm" aria-label="Agent settings tabs">
        {#each ["model", "skills", "tools", "context", "addons"] as tab}
          <button
            type="button"
            class="border-r border-border px-3 py-2 capitalize transition-colors last:border-r-0 {activeTab === tab ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
            aria-pressed={activeTab === tab}
            onclick={() => { activeTab = tab as typeof activeTab; }}
          >{tab}</button>
        {/each}
      </nav>

      <div class="overflow-auto p-5">
        {#if activeTab === "model"}
          <div class="space-y-4">
            <label class="block text-sm font-medium text-foreground" for="agent-model-select">Model</label>
            <select id="agent-model-select" class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={selectedModelId} onchange={handleModelSelect}>
              {#each modelOptions as option}
                <option value={option.id}>{option.label} · {option.provider ?? "Gateway"}{option.recommended ? " · recommended" : ""}</option>
              {/each}
            </select>
            <div class="grid gap-3">
              {#each modelOptions as option}
                <article class="rounded-xl border border-border bg-background/60 p-3 {selectedModelId === option.id ? 'ring-2 ring-primary/40' : ''}">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h3 class="font-medium text-foreground">{option.label}</h3>
                      <p class="text-xs text-muted-foreground">{option.provider ?? "Gateway"} · {option.id}</p>
                    </div>
                    {#if option.recommended}<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Recommended</span>{/if}
                  </div>
                  {#if option.description}<p class="mt-2 text-sm text-muted-foreground">{option.description}</p>{/if}
                </article>
              {/each}
            </div>
          </div>
        {:else if activeTab === "skills"}
          <div class="space-y-4">
            <input class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Search skills" bind:value={skillQuery} />
            <div class="grid gap-3">
              {#each filteredSkills as skill}
                <label class="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/60 p-3 hover:bg-accent/40">
                  <input type="checkbox" class="mt-1" checked={enabledSkillSet.has(skill.id)} onchange={(event) => toggleSkill(skill.id, event)} />
                  <span class="min-w-0 flex-1">
                    <span class="block font-medium text-foreground">{skill.label}</span>
                    <span class="block text-xs text-muted-foreground">{skill.id}{skill.familyId ? ` · ${skill.familyId}` : ""}</span>
                    {#if skill.description}<span class="mt-1 block text-sm text-muted-foreground">{skill.description}</span>{/if}
                  </span>
                </label>
              {/each}
            </div>
          </div>
        {:else if activeTab === "tools"}
          <div class="space-y-4">
            <input class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Search tool families" bind:value={toolQuery} />
            <div class="grid gap-3">
              {#each filteredToolFamilies as family}
                <article class="rounded-xl border border-border bg-background/60 p-3">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <h3 class="font-medium text-foreground">{family.label}</h3>
                      <p class="text-xs text-muted-foreground">{family.id}{family.commandCount ? ` · ${family.commandCount} commands` : ""}</p>
                      {#if family.description}<p class="mt-1 text-sm text-muted-foreground">{family.description}</p>{/if}
                    </div>
                    <select class="rounded-md border border-border bg-background px-2 py-1 text-sm" value={family.mode} onchange={(event) => changePermission(family.id, event)} aria-label={`Permission for ${family.label}`}>
                      <option value="off">Off</option>
                      <option value="ask">Ask</option>
                      <option value="allow">Allow</option>
                    </select>
                  </div>
                </article>
              {/each}
            </div>
          </div>
        {:else if activeTab === "context"}
          <div class="space-y-3">
            <p class="text-sm text-muted-foreground">Context shown here is donated by the host page or attached in the composer. Remove chips from the composer to keep them out of the next turn.</p>
            {#if contextItems.length === 0}
              <p class="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No page/document context is attached.</p>
            {:else}
              {#each contextItems as item}
                <div class="rounded-xl border border-border bg-background/60 p-3">
                  <p class="font-medium text-foreground">{item.label}</p>
                  <p class="text-xs text-muted-foreground">{item.kind ?? "context"} · {item.id}</p>
                </div>
              {/each}
            {/if}
          </div>
        {:else}
          <div class="space-y-3">
            <p class="text-sm text-muted-foreground">MCP and add-on connections will use the same permission model: off, ask, allow, with OAuth/session scope controlled by the host.</p>
            {#each (addons.length ? addons : [{ id: 'mcp-placeholder', label: 'MCP add-ons', status: 'available', description: 'Placeholder for future MCP/tool connector installation.' }]) as addon}
              <article class="rounded-xl border border-border bg-background/60 p-3">
                <div class="flex items-center justify-between gap-3">
                  <h3 class="font-medium text-foreground">{addon.label}</h3>
                  <span class="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{addon.status}</span>
                </div>
                {#if addon.description}<p class="mt-1 text-sm text-muted-foreground">{addon.description}</p>{/if}
              </article>
            {/each}
          </div>
        {/if}
      </div>

      <footer class="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        {embedded ? "Embedded mode: host session, page context, and approvals are authoritative." : "Standalone mode: host-specific commands may be unavailable without signed context."}
      </footer>
    </div>
  {/if}
</div>
