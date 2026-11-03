#!/usr/bin/env node
/**
 * ani.stream importer CLI. Runs on Node ≥ 22.18 directly from TypeScript (type stripping).
 *   npm run test-encode -w @ani/import -- [files...] [options]
 */
import { testEncode } from './test-encode.ts';

const commands: Record<string, (argv: string[]) => Promise<void>> = {
  'test-encode': testEncode,
};

const [cmd, ...rest] = process.argv.slice(2);
const run = cmd ? commands[cmd] : undefined;

if (!run) {
  console.log(`Usage: node tools/import/src/cli.ts <command> [...]\nCommands: ${Object.keys(commands).join(', ')}`);
  process.exit(cmd ? 1 : 0);
}

run(rest).catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
