import { NoBugDbError } from '../driver/errors.js';
import type { QueryResult } from '../driver/types.js';
import type { QueryExecutor } from '../query-builder/prepared.js';
import { AlterTableBuilderImpl } from './ddl/alter-table-builder.js';
import { assertValidPartitionValues } from './ddl/partition.js';
import {
  generateCallSql,
  generateCreateFunctionSql,
  generateCreateIndexSql,
  generateCreatePartitionSql,
  generateCreatePartitionedTableSql,
  generateCreateProcedureSql,
  generateCreateTableSql,
  generateCreateTriggerSql,
  generateCreateViewSql,
  generateDropFunctionSql,
  generateDropIndexSql,
  generateDropProcedureSql,
  generateDropTableSql,
  generateDropTriggerSql,
  generateDropViewSql,
} from './ddl/sql-generator.js';
import { TableBuilderImpl } from './ddl/table-builder.js';
import type {
  AlterTableBuilder,
  CreateFunctionOptions,
  CreateProcedureOptions,
  CreateTriggerOptions,
  HashPartitionValues,
  MigrationBuilder,
  MigrationContext,
  PartitionedTableOptions,
  RangePartitionValues,
  TableBuilder,
} from './types.js';

async function executeSql(executor: QueryExecutor, sql: string): Promise<QueryResult> {
  const result = await executor.query(sql);
  if (!result.success) {
    throw new NoBugDbError('QUERY_FAILED', result.message || `Query failed: ${sql}`);
  }
  return result;
}

class MigrationBuilderImpl implements MigrationBuilder {
  readonly #executor: QueryExecutor;

  constructor(executor: QueryExecutor) {
    this.#executor = executor;
  }

  async createTable(name: string, fn: (t: TableBuilder) => void): Promise<void> {
    const builder = new TableBuilderImpl();
    fn(builder);
    const sql = generateCreateTableSql(name, builder.getColumns(), {
      checks: builder.getChecks(),
      primaryKey: builder.getPrimaryKey(),
      uniques: builder.getUniques(),
    });
    await executeSql(this.#executor, sql);
  }

  async createPartitionedTable(
    name: string,
    options: PartitionedTableOptions,
    fn: (t: TableBuilder) => void,
  ): Promise<void> {
    const builder = new TableBuilderImpl();
    fn(builder);
    const sql = generateCreatePartitionedTableSql(
      name,
      builder.getColumns(),
      options,
      builder.getChecks(),
    );
    await executeSql(this.#executor, sql);
  }

  async createPartition(
    name: string,
    parent: string,
    values: RangePartitionValues | HashPartitionValues,
  ): Promise<void> {
    const validated = assertValidPartitionValues(values);
    const sql = generateCreatePartitionSql(name, parent, validated);
    await executeSql(this.#executor, sql);
  }

  async dropTable(name: string): Promise<void> {
    await executeSql(this.#executor, generateDropTableSql(name));
  }

  async alterTable(name: string, fn: (t: AlterTableBuilder) => void): Promise<void> {
    const builder = new AlterTableBuilderImpl(name);
    fn(builder);
    for (const sql of builder.getStatements()) {
      await executeSql(this.#executor, sql);
    }
  }

  async createIndex(name: string, table: string, columns: string[]): Promise<void> {
    await executeSql(this.#executor, generateCreateIndexSql(name, table, columns));
  }

  async dropIndex(name: string): Promise<void> {
    await executeSql(this.#executor, generateDropIndexSql(name));
  }

  async createView(name: string, sql: string): Promise<void> {
    await executeSql(this.#executor, generateCreateViewSql(name, sql));
  }

  async dropView(name: string): Promise<void> {
    await executeSql(this.#executor, generateDropViewSql(name));
  }

  async createTrigger(name: string, options: CreateTriggerOptions): Promise<void> {
    await executeSql(this.#executor, generateCreateTriggerSql(name, options));
  }

  async dropTrigger(name: string): Promise<void> {
    await executeSql(this.#executor, generateDropTriggerSql(name));
  }

  async createFunction(name: string, options: CreateFunctionOptions): Promise<void> {
    await executeSql(this.#executor, generateCreateFunctionSql(name, options));
  }

  async dropFunction(name: string): Promise<void> {
    await executeSql(this.#executor, generateDropFunctionSql(name));
  }

  async createProcedure(name: string, options: CreateProcedureOptions): Promise<void> {
    await executeSql(this.#executor, generateCreateProcedureSql(name, options));
  }

  async dropProcedure(name: string): Promise<void> {
    await executeSql(this.#executor, generateDropProcedureSql(name));
  }

  async call(name: string, args: unknown[] = []): Promise<void> {
    await executeSql(this.#executor, generateCallSql(name, args));
  }

  async raw(sql: string): Promise<void> {
    await executeSql(this.#executor, sql);
  }
}

export function createMigrationContext(executor: QueryExecutor): MigrationContext {
  const schema = new MigrationBuilderImpl(executor);
  return {
    query: async (sql: string) => executeSql(executor, sql),
    schema,
  };
}
