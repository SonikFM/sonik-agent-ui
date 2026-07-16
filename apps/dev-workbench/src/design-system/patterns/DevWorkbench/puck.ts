import { devWorkbenchStartingFixture } from "./fixtures";

export const devWorkbenchBuilderAdapter = {
  id: "sonik.dev-workbench.Workbench",
  category: "Developer workspaces",
  slots: [],
  allowedParents: ["page"],
  allowedChildren: [],
  fields: {
    title: { type: "text", label: "Workbench title" },
    repository: { type: "object", label: "Repository status", readOnly: true },
    workspace: { type: "object", label: "Workspace status", readOnly: true },
  },
  defaultProps: devWorkbenchStartingFixture,
  previewProps: devWorkbenchStartingFixture,
} as const;
