/**
 * Environment-variable readers with explicit error messages on bad input.
 * Kept separate from server.ts so they're trivial to unit-test.
 */

export function required(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export function intEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid integer for environment variable ${name}: ${raw}`);
  }
  return n;
}
