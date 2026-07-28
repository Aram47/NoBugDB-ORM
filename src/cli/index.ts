#!/usr/bin/env node
import { loadConfig, resolveMigrationsDir } from './config.js';
import { createMigrationFile } from './commands/migration-create.js';
import { runMigrationDown } from './commands/migration-down.js';
import { runMigrationStatus } from './commands/migration-status.js';
import { runMigrationUp } from './commands/migration-up.js';

interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  configPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let configPath = 'nobugdb-orm.config.ts';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--config') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('--config requires a path');
      }
      configPath = next;
      i += 1;
      continue;
    }
    positional.push(arg);
  }

  const command = positional[0];
  return {
    command,
    positional: command !== undefined ? positional.slice(1) : positional,
    configPath,
  };
}

function printUsage(): void {
  console.log(`
nobugdb-orm — NoBugDB ORM CLI

Usage:
  nobugdb-orm migration:create <name>   Create a new migration file
  nobugdb-orm migration:up              Apply pending migrations
  nobugdb-orm migration:down [n]        Revert last n migrations (default 1)
  nobugdb-orm migration:status          Show applied/pending migrations

Options:
  --config <path>   Config file (default: nobugdb-orm.config.ts)
`);
}

async function main(): Promise<void> {
  const { command, positional, configPath } = parseArgs(process.argv);

  const wantsHelp =
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h' ||
    positional.includes('--help') ||
    positional.includes('-h');

  if (wantsHelp) {
    printUsage();
    // Explicit help → 0; bare invocation → 1
    process.exit(command ? 0 : 1);
  }

  if (command === 'migration:create') {
    const name = positional[0];
    if (!name) {
      console.error('migration:create requires a name');
      process.exit(1);
    }

    const config = await loadConfig(configPath);
    const migrationsDir = resolveMigrationsDir(config, configPath);
    const filePath = await createMigrationFile(migrationsDir, name);
    console.log(`Created migration: ${filePath}`);
    return;
  }

  const config = await loadConfig(configPath);

  if (command === 'migration:up') {
    const applied = await runMigrationUp(config, configPath);
    if (applied.length === 0) {
      console.log('No pending migrations.');
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const id of applied) {
        console.log(`  + ${id}`);
      }
    }
    return;
  }

  if (command === 'migration:down') {
    const steps = positional[0] ? Number(positional[0]) : 1;
    if (!Number.isInteger(steps) || steps < 1) {
      console.error('migration:down steps must be a positive integer');
      process.exit(1);
    }
    const reverted = await runMigrationDown(config, configPath, steps);
    if (reverted.length === 0) {
      console.log('No migrations to revert.');
    } else {
      console.log(`Reverted ${reverted.length} migration(s):`);
      for (const id of reverted) {
        console.log(`  - ${id}`);
      }
    }
    return;
  }

  if (command === 'migration:status') {
    const entries = await runMigrationStatus(config, configPath);
    if (entries.length === 0) {
      console.log('No migration files found.');
      return;
    }
    for (const entry of entries) {
      const label = entry.applied ? 'applied' : 'pending';
      console.log(`[${label}] ${entry.id}`);
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
