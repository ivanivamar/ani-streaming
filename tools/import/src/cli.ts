#!/usr/bin/env node
/**
 * ani.stream importer CLI. Runs on Node ≥ 22.18 directly from TypeScript (type stripping).
 *   npm run dry-run     -w @ani/import -- [paths…] [options]
 *   npm run import      -w @ani/import -- [paths…] [options]
 *   npm run test-encode -w @ani/import -- [files…] [options]
 *   npm run allow       -w @ani/import -- <uid…> [--remove]   (app allowlist, config/access)
 *   npm run agent       -w @ani/import -- [--src <folder>]   (the app's Import page; runs until Ctrl+C)
 *
 * Only the resolve hook is imported statically: the commands load after it is registered,
 * so `@ani/contracts` (extensionless imports) resolves.
 */
import './resolve-ts.ts';

const commands: Record<string, (argv: string[]) => Promise<void>> = {
  'test-encode': async (argv) => (await import('./test-encode.ts')).testEncode(argv),
  'dry-run': async (argv) => (await import('./import.ts')).runImport(argv, true),
  import: async (argv) => (await import('./import.ts')).runImport(argv, false),
  allow: async (argv) => (await import('./allow.ts')).allow(argv),
  agent: async (argv) => (await import('./agent.ts')).agent(argv),
};

const [cmd, ...rest] = process.argv.slice(2);
const run = cmd ? commands[cmd] : undefined;

if (!run || rest.includes('--help')) {
  console.log(`Usage: node tools/import/src/cli.ts <command> [...]\nCommands: ${Object.keys(commands).join(', ')}`);
  if (cmd === 'import' || cmd === 'dry-run') console.log((await import('./import.ts')).IMPORT_HELP);
  process.exit(run || !cmd ? 0 : 1);
}

run(rest).catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
