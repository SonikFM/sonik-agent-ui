// Build-time developer allowlist. Add a deployment origin deliberately; page markup cannot expand it.
export const allowedWorkbenchOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://dev-workbench-sooty.vercel.app",
  "https://dev-workbench-danletterio-5975s-projects.vercel.app",
]);
