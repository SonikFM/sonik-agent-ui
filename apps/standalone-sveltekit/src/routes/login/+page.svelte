<script lang="ts">
  import { enhance } from "$app/forms";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();
  let submitting = $state(false);
</script>

<svelte:head>
  <title>Sign in - Sonik Chat</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
  <h1 class="mb-6 text-lg font-medium">Sign in</h1>

  <form
    method="POST"
    class="flex flex-col gap-4"
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        await update();
        submitting = false;
      };
    }}
  >
    <label class="flex flex-col gap-1 text-sm">
      Email
      <input
        class="input input-bordered w-full"
        type="email"
        name="email"
        autocomplete="email"
        value={form?.email ?? ""}
        required
      />
    </label>

    <label class="flex flex-col gap-1 text-sm">
      Password
      <input
        class="input input-bordered w-full"
        type="password"
        name="password"
        autocomplete="current-password"
        required
      />
    </label>

    {#if form?.error}
      <p class="text-sm text-error" role="alert">{form.error}</p>
    {/if}

    <button class="btn btn-primary" type="submit" disabled={submitting}>
      {submitting ? "Signing in..." : "Sign in"}
    </button>
  </form>
</main>
