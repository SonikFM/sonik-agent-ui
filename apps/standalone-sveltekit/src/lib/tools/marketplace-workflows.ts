import { tool } from "ai";
import { z } from "zod";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import { writeAgentTelemetry } from "../server/agent-telemetry.ts";
import {
  createMarketplaceInstallPreview,
  createWorkflowDefinitionArtifactSpec,
  getMarketplaceTemplateItem,
  getWorkflowTemplateDefinition,
  previewWorkflowRun,
  searchMarketplaceTemplateItems,
  type MarketplaceInstallScope,
  type WorkflowPermissionMode,
} from "../agent-workflows/templates.ts";

const installScopeSchema = z.enum(["user", "organization", "workspace"]);
const permissionModeSchema = z.enum(["off", "ask", "allow"]);
const toolPolicySchema = z.record(z.string(), permissionModeSchema).default({});

export interface InstalledMarketplaceWorkflowItem {
  id: string;
  itemId: string;
  templateId: string;
  version: string;
  scope: MarketplaceInstallScope;
  toolPolicy: Record<string, WorkflowPermissionMode>;
  installedAt: string;
}

const installedBySession = new Map<string, InstalledMarketplaceWorkflowItem[]>();

export function resetMarketplaceWorkflowFixtureInstallsForTest(sessionId: string) {
  installedBySession.delete(sessionId);
}

export function createMarketplaceWorkflowTools(context: { sessionId?: string | null; pageContext?: AgentPageContext; hostSession?: HostSessionEnvelope | null } = {}) {
  const sessionKey = context.sessionId || "anonymous";
  const hostContext = () => ({ authenticated: context.hostSession?.authenticated, organizationId: context.hostSession?.organizationId ?? null });

  async function telemetry(event: string, ok: boolean, extra: Record<string, unknown> = {}) {
    await writeAgentTelemetry({
      source: "server",
      event,
      ok,
      mode: "marketplace-workflow-fixture",
      sessionId: context.sessionId ?? undefined,
      skillFamilies: context.pageContext?.skillFamilies,
      commandFamilies: context.pageContext?.commandFamilies,
      ...extra,
    });
  }

  return {
    searchMarketplaceTemplates: tool({
      description: "Search fixture Sonik marketplace workflow/template definitions. Read-only; does not install or execute anything.",
      inputSchema: z.object({
        query: z.string().default(""),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      execute: async ({ query, limit }) => {
        const items = searchMarketplaceTemplateItems(query, limit, context.pageContext);
        await telemetry("tool.marketplace.search", true, { query, elementCount: items.length });
        return { kind: "marketplace-template-search" as const, provider: "sonik-agent-ui-marketplace-fixture", totalMatches: items.length, items };
      },
    }),
    getMarketplaceTemplate: tool({
      description: "Read one fixture marketplace template item and workflow definition. Read-only.",
      inputSchema: z.object({ itemId: z.string() }),
      execute: async ({ itemId }) => {
        const item = getMarketplaceTemplateItem(itemId);
        const template = item ? getWorkflowTemplateDefinition(item.templateId) : null;
        await telemetry("tool.marketplace.getItem", Boolean(item), { toolCallId: itemId });
        return item
          ? { kind: "marketplace-template-detail" as const, ok: true, item, template }
          : { kind: "marketplace-template-detail" as const, ok: false, error: "template_not_found", item: null, template: null };
      },
    }),
    getMarketplaceInstallPreview: tool({
      description: "Preview marketplace template dependencies, install scope, permissions, and approval policy. This never installs, mutates, approves, or executes commands.",
      inputSchema: z.object({
        itemId: z.string(),
        scope: installScopeSchema.optional(),
        toolPolicy: toolPolicySchema.optional(),
      }),
      execute: async ({ itemId, scope, toolPolicy }) => {
        const preview = createMarketplaceInstallPreview({ itemId, scope, toolPolicy, hostContext: hostContext(), pageContext: context.pageContext });
        await telemetry("tool.marketplace.getInstallPreview", Boolean(preview), { toolCallId: itemId });
        return preview
          ? { kind: "marketplace-install-preview" as const, ok: true, preview }
          : { kind: "marketplace-install-preview" as const, ok: false, error: "template_not_found", preview: null };
      },
    }),
    installMarketplaceTemplate: tool({
      description: "Install a fixture marketplace template into this session/workspace configuration only. Install changes visibility/configuration; it does not approve or execute workflow commands.",
      inputSchema: z.object({
        itemId: z.string(),
        scope: installScopeSchema.default("workspace"),
        toolPolicy: toolPolicySchema.optional(),
      }),
      execute: async ({ itemId, scope, toolPolicy }) => {
        const preview = createMarketplaceInstallPreview({ itemId, scope, toolPolicy, hostContext: hostContext(), pageContext: context.pageContext });
        if (!preview) {
          await telemetry("tool.marketplace.installItem", false, { toolCallId: itemId });
          return { kind: "marketplace-install" as const, ok: false, error: "template_not_found", installed: null };
        }
        if (!preview.canInstall) {
          await telemetry("tool.marketplace.installItem", false, { toolCallId: itemId, reasons: preview.disabledReasons });
          return { kind: "marketplace-install" as const, ok: false, error: "install_blocked", disabledReasons: preview.disabledReasons, installed: null };
        }
        const installed: InstalledMarketplaceWorkflowItem = {
          id: `installed-${preview.item.id}-${sessionKey}`,
          itemId: preview.item.id,
          templateId: preview.item.templateId,
          version: preview.item.version,
          scope,
          toolPolicy: { ...preview.permissionDefaults },
          installedAt: new Date().toISOString(),
        };
        const current = installedBySession.get(sessionKey) ?? [];
        installedBySession.set(sessionKey, [...current.filter((entry) => entry.itemId !== preview.item.id), installed]);
        await telemetry("tool.marketplace.installItem", true, { toolCallId: itemId });
        return {
          kind: "marketplace-install" as const,
          ok: true,
          installed,
          safety: "Installed configuration only. This does not grant trusted command approval or execute workflow nodes.",
        };
      },
    }),
    listInstalledMarketplaceTemplates: tool({
      description: "List fixture marketplace templates installed in this session/workspace configuration. Read-only.",
      inputSchema: z.object({}),
      execute: async () => {
        const installed = installedBySession.get(sessionKey) ?? [];
        await telemetry("tool.marketplace.listInstalled", true, { elementCount: installed.length });
        return { kind: "marketplace-installed-list" as const, installed };
      },
    }),
    createWorkflowTemplateArtifact: tool({
      description: "Create a JSON-render workflow-definition artifact spec for a workflow template. The artifact is preview/edit state only; it does not install, approve, or execute commands.",
      inputSchema: z.object({ templateId: z.string() }),
      execute: async ({ templateId }) => {
        const spec = createWorkflowDefinitionArtifactSpec(templateId);
        await telemetry("tool.workflow.definitionArtifact", Boolean(spec), { toolCallId: templateId });
        return spec
          ? { kind: "workflow-definition-artifact" as const, ok: true, templateId, spec }
          : { kind: "workflow-definition-artifact" as const, ok: false, error: "template_not_found", spec: null };
      },
    }),
    previewWorkflowTemplateRun: tool({
      description: "Preview how a workflow template would run. Preview is declarative only and never executes commit nodes.",
      inputSchema: z.object({
        templateId: z.string(),
        toolPolicy: toolPolicySchema.optional(),
      }),
      execute: async ({ templateId, toolPolicy }) => {
        const preview = previewWorkflowRun(templateId, toolPolicy ?? {});
        await telemetry("tool.workflow.previewRun", Boolean(preview), { toolCallId: templateId });
        return preview
          ? { kind: "workflow-run-preview" as const, ok: true, preview }
          : { kind: "workflow-run-preview" as const, ok: false, error: "template_not_found", preview: null };
      },
    }),
    requestWorkflowApproval: tool({
      description: "Request a trusted approval card for a workflow. This records/returns an approval request only; it does not grant approval and cannot commit commands.",
      inputSchema: z.object({ templateId: z.string(), reason: z.string().optional() }),
      execute: async ({ templateId, reason }) => {
        const template = getWorkflowTemplateDefinition(templateId);
        await telemetry("tool.workflow.requestApproval", Boolean(template), { toolCallId: templateId });
        return template
          ? {
            kind: "workflow-approval-request" as const,
            ok: true,
            templateId,
            status: "approval_requested",
            approvalGranted: false,
            canCommit: false,
            reason: reason ?? null,
            message: "Approval request/card created only. Trusted host approval is still required before any write command can run.",
          }
          : { kind: "workflow-approval-request" as const, ok: false, error: "template_not_found", approvalGranted: false, canCommit: false };
      },
    }),
  };
}
