export type TestExecResult = { exitCode: number; stdout: string; stderr?: string };
export type TestExec = (command: string, args: string[]) => Promise<TestExecResult>;

export type WorkspaceTestReceipt = {
  ok: boolean;
  passed: number;
  failed: number;
  durationMs: number;
};

function readSummaryField(stdout: string, field: string): number {
  const match = stdout.match(new RegExp(`^# ${field} (\\S+)$`, "m"));
  return match ? Number(match[1]) : 0;
}

export async function runWorkspaceTests({ filter, exec }: { filter?: string; exec: TestExec }): Promise<WorkspaceTestReceipt> {
  try {
    const args = ["--test", ...(filter ? [`--test-name-pattern=${filter}`] : [])];
    const result = await exec("node", args);
    const passed = readSummaryField(result.stdout, "pass");
    const failed = readSummaryField(result.stdout, "fail");
    const durationMs = readSummaryField(result.stdout, "duration_ms");
    return { ok: result.exitCode === 0 && failed === 0, passed, failed, durationMs };
  } catch {
    // sandbox exec crashed or rejected: report failure, never throw.
    return { ok: false, passed: 0, failed: 0, durationMs: 0 };
  }
}
