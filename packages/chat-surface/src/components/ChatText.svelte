<script lang="ts" module>
  import type { InlineToken } from "../chat-text.js";

  export interface ChatTextProps {
    text: string;
    compact?: boolean;
    streaming?: boolean;
  }
</script>

<script lang="ts">
  let { text, compact = false, streaming = false }: ChatTextProps = $props();

  import { renderChatText } from "../chat-text.js";

  const blocks = $derived(streaming ? [] : renderChatText(text));
</script>

{#snippet renderInline(tokens: InlineToken[])}
  {#each tokens as token, index (`${token.kind}-${index}-${token.text}`)}
    {#if token.kind === "strong"}
      <strong>{token.text}</strong>
    {:else if token.kind === "em"}
      <em>{token.text}</em>
    {:else if token.kind === "code"}
      <code>{token.text}</code>
    {:else if token.kind === "link"}
      <a href={token.href} target="_blank" rel="noopener noreferrer">{token.text}</a>
    {:else}
      {token.text}
    {/if}
  {/each}
{/snippet}

<div class="chat-text" class:chat-text--compact={compact}>
  {#if streaming}
    <p class="chat-text__streaming">{text}</p>
  {:else}
    {#each blocks as block, index (`${block.kind}-${index}`)}
      {#if block.kind === "paragraph"}
        <p>{@render renderInline(block.tokens)}</p>
      {:else if block.kind === "heading" && block.level === 1}
        <h1>{@render renderInline(block.tokens)}</h1>
      {:else if block.kind === "heading" && block.level === 2}
        <h2>{@render renderInline(block.tokens)}</h2>
      {:else if block.kind === "heading" && block.level === 3}
        <h3>{@render renderInline(block.tokens)}</h3>
      {:else if block.kind === "heading"}
        <h4>{@render renderInline(block.tokens)}</h4>
      {:else if block.kind === "list" && block.ordered}
        <ol>
          {#each block.items as item, itemIndex (itemIndex)}
            <li>{@render renderInline(item)}</li>
          {/each}
        </ol>
      {:else if block.kind === "list"}
        <ul>
          {#each block.items as item, itemIndex (itemIndex)}
            <li>{@render renderInline(item)}</li>
          {/each}
        </ul>
      {:else if block.kind === "code"}
        <pre><code data-language={block.language}>{block.text}</code></pre>
      {:else if block.kind === "table"}
        <div class="chat-text__table-scroll">
          <table>
            <thead>
              <tr>
                {#each block.headers as header, headerIndex (headerIndex)}
                  <th>{@render renderInline(header)}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each block.rows as row, rowIndex (rowIndex)}
                <tr>
                  {#each block.headers as _header, cellIndex (cellIndex)}
                    <td>{@render renderInline(row[cellIndex] ?? [])}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .chat-text {
    overflow-wrap: anywhere;
    color: inherit;
    font-size: 0.9375rem;
    line-height: 1.65;
  }

  .chat-text--compact {
    font-size: 0.875rem;
    line-height: 1.55;
  }

  .chat-text__streaming {
    white-space: pre-wrap;
  }

  .chat-text :global(> * + *) {
    margin-top: 0.75rem;
  }

  .chat-text :global(h1),
  .chat-text :global(h2),
  .chat-text :global(h3),
  .chat-text :global(h4) {
    color: var(--foreground);
    font-weight: 750;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  .chat-text :global(h1) {
    font-size: 1.35rem;
  }

  .chat-text :global(h2) {
    font-size: 1.2rem;
  }

  .chat-text :global(h3) {
    font-size: 1.05rem;
  }

  .chat-text :global(strong) {
    color: var(--foreground);
    font-weight: 750;
  }

  .chat-text :global(em) {
    color: color-mix(in oklab, var(--foreground) 86%, var(--muted-foreground));
  }

  .chat-text :global(code) {
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.35rem;
    background: color-mix(in oklab, var(--muted) 58%, transparent);
    padding: 0.08rem 0.28rem;
    font-family: var(--app-font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace);
    font-size: 0.86em;
  }

  .chat-text :global(pre) {
    overflow: auto;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.75rem;
    background: color-mix(in oklab, var(--muted) 42%, transparent);
    padding: 0.85rem;
  }

  .chat-text :global(pre code) {
    border: 0;
    background: transparent;
    padding: 0;
  }

  .chat-text :global(ul),
  .chat-text :global(ol) {
    padding-left: 1.25rem;
  }

  .chat-text :global(li + li) {
    margin-top: 0.25rem;
  }

  .chat-text :global(a) {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }

  .chat-text__table-scroll {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.75rem;
    background: color-mix(in oklab, var(--card) 82%, transparent);
  }

  table {
    width: 100%;
    min-width: 28rem;
    border-collapse: collapse;
    font-size: 0.86rem;
  }

  th,
  td {
    border-bottom: 1px solid var(--sonik-border-color);
    padding: 0.55rem 0.65rem;
    text-align: left;
    vertical-align: top;
  }

  th {
    color: var(--foreground);
    font-weight: 750;
  }

  tr:last-child td {
    border-bottom: 0;
  }
</style>
