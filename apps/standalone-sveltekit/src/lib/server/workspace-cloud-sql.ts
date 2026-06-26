import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { WorkspaceSqlExecutor, WorkspaceSqlTransaction } from "@sonik-agent-ui/workspace-session";

export class WorkspaceCloudSqlConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceCloudSqlConfigurationError";
  }
}

export function createNeonWorkspaceSqlExecutor(connectionString: string): WorkspaceSqlExecutor {
  const trimmed = connectionString.trim();
  if (!trimmed) throw new WorkspaceCloudSqlConfigurationError("Cloud workspace persistence requires a non-empty database connection string.");
  return new NeonWorkspaceSqlExecutor(neon(trimmed));
}

class NeonWorkspaceSqlExecutor implements WorkspaceSqlExecutor {
  readonly #sql: NeonQueryFunction<false, false>;

  constructor(sql: NeonQueryFunction<false, false>) {
    this.#sql = sql;
  }

  async transaction<T>(fn: (tx: WorkspaceSqlTransaction) => Promise<T>): Promise<T> {
    const tx = new NeonRequestContextTransaction(this.#sql);
    return fn(tx);
  }
}

class NeonRequestContextTransaction implements WorkspaceSqlTransaction {
  readonly #sql: NeonQueryFunction<false, false>;
  #organizationId: string | null = null;
  #userId: string | null = null;

  constructor(sql: NeonQueryFunction<false, false>) {
    this.#sql = sql;
  }

  async query<T = unknown>(query: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    if (isSetRequestContextQuery(query)) {
      this.#organizationId = normalizeContextValue(params[0], "organization id");
      this.#userId = normalizeContextValue(params[1], "user id");
      return { rows: [] };
    }

    if (this.#organizationId && this.#userId) {
      const results = await this.#sql.transaction((sql) => [
        sql.query("select sonik_agent_ui.set_request_context($1, $2)", [this.#organizationId, this.#userId]),
        sql.query(query, params),
      ]);
      return { rows: (results[1] ?? []) as T[] };
    }

    const rows = await this.#sql.query(query, params);
    return { rows: rows as T[] };
  }
}

function isSetRequestContextQuery(query: string): boolean {
  return /sonik_agent_ui\.set_request_context\s*\(/i.test(query);
}

function normalizeContextValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new WorkspaceCloudSqlConfigurationError(`Cloud workspace persistence requires ${label}.`);
  return value.trim();
}
