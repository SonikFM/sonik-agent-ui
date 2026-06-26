<script lang="ts">
  import { onMount } from "svelte";
  import { DOCUMENT_THEME_OPTIONS, THEME_GROUPS } from "./theme-registry";
  import { commitThemeSetting, readStoredThemeSetting, type ThemeSetting } from "./theme-runtime";

  let value = $state<ThemeSetting>("system");

  const groupedOptions = $derived(
    THEME_GROUPS.map((group) => ({
      ...group,
      options: DOCUMENT_THEME_OPTIONS.filter((option) => option.group === group.id),
    })).filter((group) => group.options.length > 0),
  );

  onMount(() => {
    value = readStoredThemeSetting();
  });

  function handleChange(event: Event) {
    const next = (event.currentTarget as HTMLSelectElement).value as ThemeSetting;
    value = next;
    commitThemeSetting(next);
  }
</script>

<label class="theme-picker" aria-label="Select app theme">
  <span class="theme-picker__label">Theme</span>
  <select class="theme-picker__select select select-sm select-bordered" bind:value onchange={handleChange}>
    <option value="system">System</option>
    {#each groupedOptions as group (group.id)}
      <optgroup label={group.title}>
        {#each group.options as option (option.id)}
          <option value={option.id}>{option.title}</option>
        {/each}
      </optgroup>
    {/each}
  </select>
</label>

<style>
  .theme-picker {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--muted-foreground);
    font-size: 0.8125rem;
  }

  .theme-picker__label {
    display: none;
  }

  .theme-picker__select {
    min-height: 2rem;
    border-color: var(--app-card-border);
    background: var(--app-control-bg);
    color: var(--color-base-content);
  }

  @media (min-width: 760px) {
    .theme-picker__label {
      display: inline;
    }
  }
</style>
