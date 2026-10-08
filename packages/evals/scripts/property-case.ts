// Runs the property fixture's analyst case (M06b) in a throwaway database and prints it, or writes it to
// cases/property-sg-0001.json with --write.
//
//   pnpm --filter @ads/evals case:property [--write]                 the analyst model from the environment
//                                                                    (MODEL_ANALYST and its key; traced to Langfuse
//                                                                    when its keys are set)
//   pnpm --filter @ads/evals case:property --answer <file> [--write] a hand-written answer: {"note", "output"}
//   pnpm --filter @ads/evals case:property --print-prompt           the instructions and prompt only
//
// The database: TEST_DATABASE_URL (a Postgres where the user may create databases; see @ads/db/testing), or the
// local default. Nothing touches an ad account or the agent's own database.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { analystInstructions, createModelTracing } from '@ads/core';
import { createTestDatabase } from '@ads/db/testing';
import { runPropertyCase } from '../src/index.ts';

const { values } = parseArgs({
  options: {
    answer: { type: 'string' },
    write: { type: 'boolean', default: false },
    'print-prompt': { type: 'boolean', default: false },
  },
});

const CASE_FILE = new URL('../cases/property-sg-0001.json', import.meta.url);

const t = await createTestDatabase();
const tracing = values.answer === undefined && !values['print-prompt'] ? createModelTracing(process.env) : null;
try {
  const recorded =
    values['print-prompt'] === true
      ? { output: { findings: [], dismissed: [] }, note: 'prompt only' }
      : values.answer === undefined
        ? undefined
        : (JSON.parse(readFileSync(values.answer, 'utf8')) as { note: string; output: never });
  const replayCase = await runPropertyCase(t.db, {
    ...(recorded === undefined ? {} : { recorded }),
    env: process.env,
    tracing,
  });
  if (values['print-prompt'] === true) {
    console.log(`${analystInstructions({ lookups: false })}\n\n----\n\n${replayCase.input.prompt}`);
  } else if (values.write === true) {
    writeFileSync(CASE_FILE, `${JSON.stringify(replayCase, null, 2)}\n`);
    console.log(JSON.stringify({ written: CASE_FILE.pathname, result: replayCase.result }, null, 2));
  } else {
    console.log(JSON.stringify(replayCase, null, 2));
  }
} finally {
  await tracing?.shutdown();
  await t.drop();
}
