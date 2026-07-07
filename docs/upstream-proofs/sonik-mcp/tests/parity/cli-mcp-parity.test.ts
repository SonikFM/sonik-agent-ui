import { describe, expect, it } from 'vitest';
import { runCli } from '@sonikfm/cli';
import { callMcpTool } from '@sonikfm/mcp-projection';
import { createSonikRegistry } from '@sonikfm/sonik-adapter';

describe('CLI/MCP parity', () => {
  it('returns equivalent search receipts for CLI and MCP execute', async () => {
    const cli = await runCli(['inventory', 'search', '--source', 'fixture', '--query', 'jazz', '--limit', '2', '--json']);
    const mcp = await callMcpTool('sonik_command_execute', { commandId: 'sonik.inventory.search', input: { query: 'jazz', limit: 2, source: 'fixture' } }, createSonikRegistry());
    expect(cli.exitCode).toBe(0);
    expect(cli.receipt?.commandId).toBe('sonik.inventory.search');
    expect((cli.receipt?.summary as { count: number }).count).toBe((mcp.structuredContent as { summary: { count: number } }).summary.count);
  });


  it('returns equivalent purchase preview receipts for CLI and MCP execute', async () => {
    const cli = await runCli(['purchase', 'preview', '--source', 'fixture', '--inventory-id', 'evt_sonik_jazz_rooftop', '--quantity', '2', '--json']);
    const mcp = await callMcpTool('sonik_command_execute', { commandId: 'sonik.purchase.preview', input: { inventoryId: 'evt_sonik_jazz_rooftop', quantity: 2, source: 'fixture' } }, createSonikRegistry());
    expect(cli.exitCode).toBe(0);
    expect(cli.receipt?.commandId).toBe('sonik.purchase.preview');
    expect((cli.receipt?.summary as { estimate: { checkoutAvailable: boolean; totalMinor: number } }).estimate.checkoutAvailable).toBe(false);
    expect((cli.receipt?.summary as { estimate: { totalMinor: number } }).estimate.totalMinor).toBe((mcp.structuredContent as { summary: { estimate: { totalMinor: number } } }).summary.estimate.totalMinor);
  });

  it('keeps MCP text compact and structured content authoritative', async () => {
    const mcp = await callMcpTool('sonik_command_execute', { commandId: 'sonik.inventory.search', input: { query: 'salsa', source: 'fixture' } }, createSonikRegistry());
    const text = mcp.content[0]?.type === 'text' ? mcp.content[0].text : '';
    expect(text).toContain('Sonik command sonik.inventory.search');
    expect(text).not.toContain('Salsa Lab Live');
    expect((mcp.structuredContent as { commandId: string }).commandId).toBe('sonik.inventory.search');
  });
});
