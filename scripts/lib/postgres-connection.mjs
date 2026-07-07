// Parse a postgres connection URL into libpq PG* environment variables so the
// credentialed connection string is never passed as a psql argv (where a
// non-zero exit would echo it — password included — to stderr and any log/tail
// capture). psql reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from the env.
export function buildPgEnv(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const env = {};
  if (parsed.hostname) env.PGHOST = decodeURIComponent(parsed.hostname);
  if (parsed.port) env.PGPORT = parsed.port;
  if (parsed.username) env.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
  const database = parsed.pathname.replace(/^\//, "");
  if (database) env.PGDATABASE = decodeURIComponent(database);
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}
