import { rollupInventories } from "../rollup/merge.js";

/**
 * CLI-level wrapper for the rollup command. Translates Commander options to
 * the merge function's signature and emits warnings to stderr.
 */
export async function runRollup({ inputs, output, strict = false }) {
  const result = await rollupInventories(inputs, output, { strict });
  for (const w of result.warnings) {
    process.stderr.write(`warning: ${w}\n`);
  }
  if (result.error) {
    process.stderr.write(`${result.error}\n`);
  }
  return { exitCode: result.exitCode, error: result.error };
}
