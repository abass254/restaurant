import { existsSync, readFileSync } from "fs";
import { join } from "path";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * Load the shared repo-root `.env.local` then `.env` (neither overrides
 * existing process.env, so `.env.local` must be read first to win).
 */
export function loadRootEnvFile(): void {
  loadEnvFile(join(__dirname, "..", ".env.local"));
  loadEnvFile(join(__dirname, "..", ".env"));
}
