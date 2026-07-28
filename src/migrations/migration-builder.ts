import { NoBugDbError } from '../driver/errors.js';
import type { QueryResult } from '../driver/types.js';
import type { QueryExecutor } from '../query-builder/prepared.js';
import { AlterTableBuilderImpl } from './ddl/alter-table-builder.js';
import {
  generateCreateIndexSql,
  generateCreateTableSql,
  generateCreateViewSql,
  generateDropIndexSql,
  generateDropTableSql,
  generateDropViewSql,
} from './ddl/sql-generator.js';
import { TableBuilderImpl } from './ddl/table-builder.js';
import type { MigrationBuilder, MigrationContext, TableBuilder, AlterTableBuilder } from './types.js';

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
    const sql = generateCreateTableSql(name, builder.getColumns());
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
