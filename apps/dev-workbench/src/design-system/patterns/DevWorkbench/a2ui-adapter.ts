import { devWorkbenchSchema, type DevWorkbenchViewProps } from "./schema";

export type DevWorkbenchAdapterResult =
  | { ok: true; props: DevWorkbenchViewProps; warnings: string[] }
  | { ok: false; error: "invalid_dev_workbench_props"; issues: string[] };

export function adaptDevWorkbenchA2ui(input: unknown): DevWorkbenchAdapterResult {
  const parsed = devWorkbenchSchema.safeParse(input);
  if (parsed.success) return { ok: true, props: parsed.data, warnings: [] };
  return {
    ok: false,
    error: "invalid_dev_workbench_props",
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
  };
}
