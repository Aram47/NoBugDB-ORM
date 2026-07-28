import { randomBytes } from 'node:crypto';
import type { QueryResult } from '../driver/types.js';
import type {
  TypeMapper} from '../types/type-mapper.js';
import {
  defaultTypeMapper,
  type NoBugDbDataType,
} from '../types/type-mapper.js';
import { escapeLiteral } from './escape.js';

export type QueryExecutor = { query(sql: string): Promise<QueryResult> };

function generatePreparedName(): string {
  return `orm_${randomBytes(6).toString('hex')}`;
}

export interface PreparedRunOptions {
  mapper?: TypeMapper;
  paramTypes?: (NoBugDbDataType | undefined)[];
}

export async function runPrepared(
  executor: QueryExecutor,
  sqlWithDollars: string,
  params: unknown[],
  options: PreparedRunOptions = {},
): Promise<QueryResult> {
  const mapper = options.mapper ?? defaultTypeMapper;
  const name = generatePreparedName();
  const prepareSql = `PREPARE ${name} AS ${sqlWithDollars}`;

  try {
    await executor.query(prepareSql);

    const args = params.map((param, index) => {
      const type = options.paramTypes?.[index];
      return escapeLiteral(param, type, mapper);
    });
    const executeSql =
      args.length > 0 ? `EXECUTE ${name}(${args.join(', ')})` : `EXECUTE ${name}`;

    return await executor.query(executeSql);
  } finally {
    await executor.query(`DEALLOCATE PREPARE ${name}`).catch(() => undefined);
  }
}
