import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const configSchema = z
  .object({
    version: z.number().optional(),
    webRollup: z
      .object({
        autoDeploy: z.boolean().optional(),
        deploySite: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".filecap",
  "config.json",
);

export function loadConfig({ configPath = DEFAULT_CONFIG_PATH } = {}) {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Cannot read filecap config at ${configPath} (${err.code ?? "io error"})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in filecap config at ${configPath}`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const fieldPath = issue.path.length ? issue.path.join(".") : "(root)";
    throw new Error(
      `Invalid filecap config at ${configPath}: ${fieldPath}: ${issue.message}`,
    );
  }
  return result.data;
}
