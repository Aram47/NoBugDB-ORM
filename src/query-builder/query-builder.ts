import { NoBugDbError } from '../driver/errors.js';
import {
  DEFAULT_MAX_REQUEST_BYTES,
  type QueryResult,
} from '../driver/types.js';
import type {
  TypeMapper} from '../types/type-mapper.js';
import {
  defaultTypeMapper,
  type NoBugDbDataType,
} from '../types/type-mapper.js';
import {
  assertNotOrderByOrdinal,
  assertSupportedSqlFragment,
  assertValidIdentifier,
  escapeLiteral,
  quoteIdent,
  quoteQualifiedIdent,
} from './escape.js';
import { runPrepared, type QueryExecutor } from './prepared.js';
import {
  columnToSql,
  type SqlExpression,
  type SqlRaw,
} from './sql-fragments.js';
import type { SubquerySource } from './subquery.js';
import {
  compileWhere,
  mergeWhere,
  type WhereInput,
} from './where.js';

export type { WhereInput } from './where.js';
export type { SubquerySource } from './subquery.js';
export type { QueryExecutor } from './prepared.js';

type QueryKind = 'select' | 'insert' | 'update' | 'delete';
type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';
type SortDirection = 'ASC' | 'DESC';

export type SetOperationKind = 'union' | 'intersect' | 'except';

export interface SetOperationOptions {
  /** Only valid for UNION. Default false. */
  all?: boolean;
}

interface JoinClause {
  type: JoinType;
  table: string;
  alias?: string;
  on?: string;
}

interface OrderClause {
  column: string;
  dir: SortDirection;
}

interface SetOperationStep {
  kind: SetOperationKind;
  all?: boolean;
  right: QueryBuilderState;
}

interface SetOperationNode {
  left: QueryBuilderState;
  steps: SetOperationStep[];
}

interface QueryBuilderState {
  kind: QueryKind | null;
  selectColumns: Array<string | SqlExpression | SqlRaw>;
  distinct: boolean;
  fromTable?: string;
  fromAlias?: string;
  joins: JoinClause[];
  where?: WhereInput;
  groupBy: string[];
  having?: WhereInput;
  orderBy: OrderClause[];
  limit?: number;
  offset?: number;
  insertTable?: string;
  insertRows: Record<string, unknown>[];
  updateTable?: string;
  updateSet?: Record<string, unknown>;
  deleteTable?: string;
  /** Top-level set-op tree; when set, leaf SELECT fields on this state are unused. */
  setOperation?: SetOperationNode;
}

export interface QueryBuilderOptions {
  maxRequestBytes?: number;
  typeMapper?: TypeMapper;
  columnTypes?: Record<string, NoBugDbDataType>;
}

interface NormalizedQueryBuilderOptions {
  maxRequestBytes: number;
  typeMapper: TypeMapper;
  columnTypes?: Record<string, NoBugDbDataType>;
}

/**
 * Fluent SQL builder for the NoBugDB dialect subset.
 *
 * Supports `SELECT` / `INSERT` / `UPDATE` / `DELETE` with JOIN, WHERE,
 * GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET, basic aggregates, window helpers
 * (`ROW_NUMBER` / `RANK` / `DENSE_RANK` / running `SUM`·`AVG` via `sql.*.over()`),
 * top-level set operations (`UNION` / `UNION ALL` / `INTERSECT` / `EXCEPT`),
 * and subqueries (`IN` / `EXISTS` / scalar via {@link QueryBuilder.toSubquerySql}
 * and `sql.subquery`). Set operations are not allowed inside subqueries.
 * Rejects unsupported constructs (`LIKE`, CTE, etc.).
 * Does not generate `INTERSECT ALL` / `EXCEPT ALL` (not supported by the engine).
 *
 * {@link QueryBuilder.toSql} renders escaped literals; {@link QueryBuilder.execute}
 * / {@link QueryBuilder.executeCommand} use `PREPARE` / `EXECUTE` / `DEALLOCATE`.
 * Payloads must fit the ~4 KiB server request buffer (`maxRequestBytes`).
 */
export class QueryBuilder {
  readonly #executor: QueryExecutor;
  readonly #options: NormalizedQueryBuilderOptions;
  readonly #state: QueryBuilderState;

  constructor(
    executor: QueryExecutor,
    options: QueryBuilderOptions = {},
    state?: QueryBuilderState,
  ) {
    this.#executor = executor;
    this.#options = {
      maxRequestBytes:
        options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
      typeMapper: options.typeMapper ?? defaultTypeMapper,
      ...(options.columnTypes !== undefined
        ? { columnTypes: options.columnTypes }
        : {}),
    };
    this.#state = state ?? createEmptyState();
  }

  #clone(
    patch: Partial<QueryBuilderState>,
    clear?: ReadonlyArray<keyof QueryBuilderState>,
  ): QueryBuilder {
    const next: QueryBuilderState = {
      ...this.#state,
      ...patch,
      joins: patch.joins ?? [...this.#state.joins],
      selectColumns:
        patch.selectColumns ?? [...this.#state.selectColumns],
      groupBy: patch.groupBy ?? [...this.#state.groupBy],
      orderBy: patch.orderBy ?? [...this.#state.orderBy],
      insertRows: patch.insertRows ?? [...this.#state.insertRows],
    };
    if (clear !== undefined) {
      for (const key of clear) {
        delete next[key];
      }
    }
    return new QueryBuilder(this.#executor, this.#options, next);
  }

  #assertKind(expected: QueryKind | QueryKind[]): void {
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (this.#state.kind === null || !allowed.includes(this.#state.kind)) {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        `Invalid query builder state for this operation (kind=${this.#state.kind ?? 'unset'})`,
      );
    }
  }

  #setKind(kind: QueryKind): void {
    if (this.#state.kind !== null && this.#state.kind !== kind) {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        'Cannot mix SELECT with DML in one query builder',
      );
    }
  }

  select(...columns: Array<string | SqlExpression | SqlRaw>): this {
    this.#setKind('select');
    const nextColumns =
      columns.length === 0 ? (['*'] as Array<string | SqlExpression | SqlRaw>) : columns;
    for (const col of nextColumns) {
      if (typeof col === 'string') {
        assertSupportedSqlFragment(col);
      }
    }
    return this.#clone({ kind: 'select', selectColumns: nextColumns }) as this;
  }

  distinct(on = true): this {
    this.#assertKind('select');
    return this.#clone({ distinct: on }) as this;
  }

  from(table: string, alias?: string): this {
    this.#assertKind('select');
    assertValidIdentifier(table);
    if (alias !== undefined) {
      assertValidIdentifier(alias);
    }
    return this.#clone({
      fromTable: table,
      ...(alias !== undefined ? { fromAlias: alias } : {}),
    }) as this;
  }

  innerJoin(table: string, on: string, alias?: string): this {
    return this.#join('INNER', table, on, alias);
  }

  leftJoin(table: string, on: string, alias?: string): this {
    return this.#join('LEFT', table, on, alias);
  }

  rightJoin(table: string, on: string, alias?: string): this {
    return this.#join('RIGHT', table, on, alias);
  }

  fullJoin(table: string, on: string, alias?: string): this {
    return this.#join('FULL', table, on, alias);
  }

  crossJoin(table: string, alias?: string): this {
    return this.#join('CROSS', table, undefined, alias);
  }

  #join(
    type: JoinType,
    table: string,
    on: string | undefined,
    alias?: string,
  ): this {
    this.#assertKind('select');
    assertValidIdentifier(table);
    if (alias !== undefined) {
      assertValidIdentifier(alias);
    }
    if (type !== 'CROSS') {
      if (on === undefined || on.trim() === '') {
        throw new NoBugDbError(
          'UNSUPPORTED_SQL',
          `${type} JOIN requires an ON clause`,
        );
      }
      assertSupportedSqlFragment(on);
    }
    const join: JoinClause = { type, table };
    if (alias !== undefined) {
      join.alias = alias;
    }
    if (on !== undefined) {
      join.on = on;
    }
    const joins = [...this.#state.joins, join];
    return this.#clone({ joins }) as this;
  }

  where(clause: WhereInput): this {
    return this.#withWhere(clause, 'replace');
  }

  andWhere(clause: WhereInput): this {
    return this.#withWhere(clause, 'and');
  }

  orWhere(clause: WhereInput): this {
    return this.#withWhere(clause, 'or');
  }

  whereInSubquery(column: string, sub: SubquerySource): this {
    return this.#withWhere({ col: column, inSubquery: sub }, 'and');
  }

  whereNotInSubquery(column: string, sub: SubquerySource): this {
    return this.#withWhere({ col: column, notInSubquery: sub }, 'and');
  }

  whereExists(sub: SubquerySource): this {
    return this.#withWhere({ exists: sub }, 'and');
  }

  whereNotExists(sub: SubquerySource): this {
    return this.#withWhere({ notExists: sub }, 'and');
  }

  #withWhere(
    clause: WhereInput,
    mode: 'replace' | 'and' | 'or',
  ): this {
    if (this.#state.kind === 'select' || this.#state.kind === 'update' || this.#state.kind === 'delete') {
      const where =
        mode === 'replace'
          ? clause
          : mergeWhere(this.#state.where, clause, mode === 'and' ? 'and' : 'or');
      return this.#clone({ where }) as this;
    }
    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      'WHERE is only supported for SELECT, UPDATE, and DELETE',
    );
  }

  groupBy(...columns: string[]): this {
    this.#assertKind('select');
    for (const col of columns) {
      assertSupportedSqlFragment(col);
    }
    return this.#clone({ groupBy: columns }) as this;
  }

  having(clause: WhereInput): this {
    this.#assertKind('select');
    return this.#clone({ having: clause }) as this;
  }

  orderBy(column: string, dir: SortDirection = 'ASC'): this {
    this.#assertKind('select');
    assertNotOrderByOrdinal(column);
    assertSupportedSqlFragment(column);
    const orderBy = [...this.#state.orderBy, { column, dir }];
    return this.#clone({ orderBy }) as this;
  }

  limit(n: number): this {
    this.#assertKind('select');
    if (!Number.isInteger(n) || n < 0) {
      throw new NoBugDbError('TYPE_MISMATCH', 'LIMIT must be a non-negative integer');
    }
    return this.#clone({ limit: n }) as this;
  }

  offset(n: number): this {
    this.#assertKind('select');
    if (!Number.isInteger(n) || n < 0) {
      throw new NoBugDbError('TYPE_MISMATCH', 'OFFSET must be a non-negative integer');
    }
    return this.#clone({ offset: n }) as this;
  }

  /**
   * Combine this SELECT with `other` via `UNION` / `UNION ALL`.
   * Set operations are top-level only (engine constraint).
   */
  union(other: QueryBuilder, options?: SetOperationOptions): this {
    return this.#setOperation('union', other, options);
  }

  /**
   * Combine this SELECT with `other` via `INTERSECT` (no `ALL`).
   */
  intersect(other: QueryBuilder): this {
    return this.#setOperation('intersect', other);
  }

  /**
   * Combine this SELECT with `other` via `EXCEPT` (no `ALL`).
   */
  except(other: QueryBuilder): this {
    return this.#setOperation('except', other);
  }

  #setOperation(
    kind: SetOperationKind,
    other: QueryBuilder,
    options?: SetOperationOptions,
  ): this {
    this.#assertSelectOperand(this, 'left');
    this.#assertSelectOperand(other, 'right');

    if (options?.all === true && kind !== 'union') {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        `${kind.toUpperCase()} ALL is not supported by NoBugDB`,
      );
    }

    const step: SetOperationStep = { kind, right: cloneState(other.#state) };
    if (kind === 'union' && options?.all === true) {
      step.all = true;
    }

    const canFlatten =
      this.#state.setOperation !== undefined &&
      this.#state.orderBy.length === 0 &&
      this.#state.limit === undefined &&
      this.#state.offset === undefined;

    if (canFlatten) {
      const current = this.#state.setOperation!;
      return this.#clone(
        {
          setOperation: {
            left: current.left,
            steps: [...current.steps, step],
          },
          orderBy: [],
        },
        ['limit', 'offset'],
      ) as this;
    }

    return this.#clone(
      {
        selectColumns: [],
        distinct: false,
        joins: [],
        groupBy: [],
        setOperation: {
          left: cloneState(this.#state),
          steps: [step],
        },
        orderBy: [],
      },
      ['fromTable', 'fromAlias', 'where', 'having', 'limit', 'offset'],
    ) as this;
  }

  #assertSelectOperand(builder: QueryBuilder, side: 'left' | 'right'): void {
    if (builder.#state.kind !== 'select') {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        `Set operation ${side} operand must be a SELECT`,
      );
    }
    if (!builder.#state.fromTable && builder.#state.setOperation === undefined) {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        `Set operation ${side} operand SELECT requires FROM`,
      );
    }
  }

  #assertSubqueryOperand(builder: QueryBuilder): void {
    if (builder.#state.kind !== 'select') {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        'Subquery must be a SELECT',
      );
    }
    if (builder.#state.setOperation !== undefined) {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        'Set operations are not supported inside subqueries',
      );
    }
    if (!builder.#state.fromTable) {
      throw new NoBugDbError(
        'UNSUPPORTED_SQL',
        'Subquery SELECT requires FROM',
      );
    }
  }

  insertInto(table: string): this {
    this.#setKind('insert');
    assertValidIdentifier(table);
    return this.#clone({ kind: 'insert', insertTable: table }) as this;
  }

  values(row: Record<string, unknown> | Record<string, unknown>[]): this {
    this.#assertKind('insert');
    const rows = Array.isArray(row) ? row : [row];
    if (rows.length === 0) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'INSERT requires at least one row');
    }
    return this.#clone({
      insertRows: [...this.#state.insertRows, ...rows],
    }) as this;
  }

  update(table: string): this {
    this.#setKind('update');
    assertValidIdentifier(table);
    return this.#clone({ kind: 'update', updateTable: table }) as this;
  }

  set(values: Record<string, unknown>): this {
    this.#assertKind('update');
    if (Object.keys(values).length === 0) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'UPDATE SET cannot be empty');
    }
    return this.#clone({ updateSet: values }) as this;
  }

  deleteFrom(table: string): this {
    this.#setKind('delete');
    assertValidIdentifier(table);
    return this.#clone({ kind: 'delete', deleteTable: table }) as this;
  }

  toSql(): { sql: string } {
    const { sql } = this.#compileSql({ usePlaceholders: false });
    this.#assertRequestSize(sql);
    return { sql };
  }

  /**
   * Parenthesized SELECT fragment for use as a subquery (no execute).
   * Inner must be a plain SELECT — set operations are rejected.
   * Compiles with escaped literals (no PREPARE placeholders).
   */
  toSubquerySql(): string {
    this.#assertSubqueryOperand(this);
    const { sql } = this.#compilePlainSelect(this.#state, {
      usePlaceholders: false,
    });
    return `(${sql})`;
  }

  async execute<T = Record<string, unknown>>(): Promise<T[]> {
    this.#assertKind('select');
    const { sql, params, paramTypes } = this.#compileSql({ usePlaceholders: true });
    this.#assertRequestSize(sql);
    const result = await runPrepared(this.#executor, sql, params, {
      mapper: this.#options.typeMapper,
      paramTypes,
    });
    return this.#mapRows<T>(result);
  }

  async executeCommand(): Promise<{ affectedRows: number | null }> {
    const kind = this.#state.kind;
    if (kind === 'insert') {
      const batches = this.#compileInsertBatches({ usePlaceholders: true });
      let total = 0;
      for (const batch of batches) {
        this.#assertRequestSize(batch.sql);
        await runPrepared(this.#executor, batch.sql, batch.params, {
          mapper: this.#options.typeMapper,
          paramTypes: batch.paramTypes,
        });
        total += batch.rowCount;
      }
      return { affectedRows: total };
    }

    if (kind === 'update' || kind === 'delete') {
      const { sql, params, paramTypes } = this.#compileSql({ usePlaceholders: true });
      this.#assertRequestSize(sql);
      await runPrepared(this.#executor, sql, params, {
        mapper: this.#options.typeMapper,
        paramTypes,
      });
      return { affectedRows: null };
    }

    throw new NoBugDbError(
      'UNSUPPORTED_SQL',
      'executeCommand is only supported for INSERT, UPDATE, and DELETE',
    );
  }

  #whereCompileOptions(usePlaceholders: boolean) {
    return {
      mapper: this.#options.typeMapper,
      usePlaceholders,
      ...(this.#options.columnTypes !== undefined
        ? { columnTypes: this.#options.columnTypes }
        : {}),
    };
  }

  #compileSql(options: { usePlaceholders: boolean }): {
    sql: string;
    params: unknown[];
    paramTypes: (NoBugDbDataType | undefined)[];
  } {
    const kind = this.#state.kind;
    if (kind === 'select') {
      return this.#compileSelect(options);
    }
    if (kind === 'update') {
      return this.#compileUpdate(options);
    }
    if (kind === 'delete') {
      return this.#compileDelete(options);
    }
    if (kind === 'insert') {
      const batch = this.#compileInsertBatches(options)[0];
      if (!batch) {
        throw new NoBugDbError('UNSUPPORTED_SQL', 'INSERT has no rows');
      }
      return { sql: batch.sql, params: batch.params, paramTypes: batch.paramTypes };
    }
    throw new NoBugDbError('UNSUPPORTED_SQL', 'Query builder has no statement kind');
  }

  #compileSelect(options: { usePlaceholders: boolean }): {
    sql: string;
    params: unknown[];
    paramTypes: (NoBugDbDataType | undefined)[];
  } {
    if (this.#state.setOperation !== undefined) {
      return this.#compileSelectWithSetOperation(this.#state, options);
    }
    return this.#compilePlainSelect(this.#state, options);
  }

  #compileSelectWithSetOperation(
    state: QueryBuilderState,
    options: { usePlaceholders: boolean },
  ): {
    sql: string;
    params: unknown[];
    paramTypes: (NoBugDbDataType | undefined)[];
  } {
    const setOp = state.setOperation!;
    const acc = this.#compileSelectState(setOp.left, options);
    let sql = acc.sql;
    const params = [...acc.params];
    const paramTypes = [...acc.paramTypes];

    for (const step of setOp.steps) {
      const right = this.#compileSelectState(step.right, options);
      const rightSql = renumberPlaceholders(right.sql, params.length);
      const opKeyword = setOperationKeyword(step);
      sql = `(${sql}) ${opKeyword} (${rightSql})`;
      params.push(...right.params);
      paramTypes.push(...right.paramTypes);
    }

    const parts = [sql];
    appendOrderLimitOffset(parts, state);
    const finalSql = parts.join(' ');
    assertSupportedSqlFragment(finalSql);
    return { sql: finalSql, params, paramTypes };
  }

  #compileSelectState(
    state: QueryBuilderState,
    options: { usePlaceholders: boolean },
  ): {
    sql: string;
    params: unknown[];
    paramTypes: (NoBugDbDataType | undefined)[];
  } {
    if (state.setOperation !== undefined) {
      return this.#compileSelectWithSetOperation(state, options);
    }
    return this.#compilePlainSelect(state, options);
  }

  #compilePlainSelect(
    state: QueryBuilderState,
    options: { usePlaceholders: boolean },
  ): {
    sql: string;
    params: unknown[];
    paramTypes: (NoBugDbDataType | undefined)[];
  } {
    if (!state.fromTable) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'SELECT requires FROM');
    }

    const params: unknown[] = [];
    const paramTypes: (NoBugDbDataType | undefined)[] = [];
    const columns =
      state.selectColumns.length === 0
        ? '*'
        : state.selectColumns
            .map((col) => {
              if (typeof col === 'string') {
                return col === '*' ? '*' : quoteQualifiedIdent(col);
              }
              return columnToSql(col);
            })
            .join(', ');

    const parts = [
      `SELECT${state.distinct ? ' DISTINCT' : ''} ${columns}`,
      `FROM ${quoteIdent(state.fromTable)}${state.fromAlias ? ` ${quoteIdent(state.fromAlias)}` : ''}`,
    ];

    for (const join of state.joins) {
      parts.push(this.#compileJoin(join));
    }

    if (state.where !== undefined) {
      const where = compileWhere(state.where, this.#whereCompileOptions(options.usePlaceholders));
      params.push(...where.params);
      paramTypes.push(...where.paramTypes);
      parts.push(`WHERE ${where.sql}`);
    }

    if (state.groupBy.length > 0) {
      parts.push(
        `GROUP BY ${state.groupBy.map((col) => quoteQualifiedIdent(col)).join(', ')}`,
      );
    }

    if (state.having !== undefined) {
      const having = compileWhere(state.having, this.#whereCompileOptions(options.usePlaceholders));
      params.push(...having.params);
      paramTypes.push(...having.paramTypes);
      parts.push(`HAVING ${having.sql}`);
    }

    appendOrderLimitOffset(parts, state);

    const sql = parts.join(' ');
    assertSupportedSqlFragment(sql);
    return { sql, params, paramTypes };
  }

  #compileJoin(join: JoinClause): string {
    const table = `${quoteIdent(join.table)}${join.alias ? ` ${quoteIdent(join.alias)}` : ''}`;
    if (join.type === 'CROSS') {
      return `CROSS JOIN ${table}`;
    }
    return `${join.type} JOIN ${table} ON ${join.on}`;
  }

  #compileUpdate(options: { usePlaceholders: boolean }): {
    sql: string;
    params: unknown[];
    paramTypes: (NoBugDbDataType | undefined)[];
  } {
    if (!this.#state.updateTable || !this.#state.updateSet) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'UPDATE requires table and SET');
    }

    const params: unknown[] = [];
    const paramTypes: (NoBugDbDataType | undefined)[] = [];
    const assignments = Object.entries(this.#state.updateSet).map(
      ([column, value]) => {
        const col = quoteIdent(column);
        if (options.usePlaceholders) {
          params.push(value);
          paramTypes.push(this.#options.columnTypes?.[column]);
          return `${col} = $${params.length}`;
        }
        return `${col} = ${escapeLiteral(
          value,
          this.#options.columnTypes?.[column],
          this.#options.typeMapper,
        )}`;
      },
    );

    const parts = [
      `UPDATE ${quoteIdent(this.#state.updateTable)} SET ${assignments.join(', ')}`,
    ];

    if (this.#state.where !== undefined) {
      const where = compileWhere(this.#state.where, this.#whereCompileOptions(options.usePlaceholders));
      params.push(...where.params);
      paramTypes.push(...where.paramTypes);
      parts.push(`WHERE ${where.sql}`);
    }

    const sql = parts.join(' ');
    assertSupportedSqlFragment(sql);
    return { sql, params, paramTypes };
  }

  #compileDelete(options: { usePlaceholders: boolean }): {
    sql: string;
    params: unknown[];
    paramTypes: (NoBugDbDataType | undefined)[];
  } {
    if (!this.#state.deleteTable) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'DELETE requires a table');
    }

    const params: unknown[] = [];
    const paramTypes: (NoBugDbDataType | undefined)[] = [];
    const parts = [`DELETE FROM ${quoteIdent(this.#state.deleteTable)}`];

    if (this.#state.where !== undefined) {
      const where = compileWhere(this.#state.where, this.#whereCompileOptions(options.usePlaceholders));
      params.push(...where.params);
      paramTypes.push(...where.paramTypes);
      parts.push(`WHERE ${where.sql}`);
    }

    const sql = parts.join(' ');
    assertSupportedSqlFragment(sql);
    return { sql, params, paramTypes };
  }

  #compileInsertBatches(options: { usePlaceholders: boolean }): Array<{
    sql: string;
    params: unknown[];
    paramTypes: (NoBugDbDataType | undefined)[];
    rowCount: number;
  }> {
    if (!this.#state.insertTable || this.#state.insertRows.length === 0) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'INSERT requires table and values');
    }

    const columns = Object.keys(this.#state.insertRows[0]!);
    if (columns.length === 0) {
      throw new NoBugDbError('UNSUPPORTED_SQL', 'INSERT row has no columns');
    }

    for (const row of this.#state.insertRows) {
      const rowColumns = Object.keys(row);
      if (rowColumns.length !== columns.length) {
        throw new NoBugDbError(
          'UNSUPPORTED_SQL',
          'All INSERT rows must have the same columns',
        );
      }
      for (const column of columns) {
        if (!(column in row)) {
          throw new NoBugDbError(
            'UNSUPPORTED_SQL',
            `INSERT row is missing column ${column}`,
          );
        }
      }
    }

    const quotedColumns = columns.map((column) => quoteIdent(column));
    const batches: Array<{
      sql: string;
      params: unknown[];
      paramTypes: (NoBugDbDataType | undefined)[];
      rowCount: number;
    }> = [];
    let currentRows: Record<string, unknown>[] = [];

    const flush = (): void => {
      if (currentRows.length === 0) {
        return;
      }
      const built = this.#buildInsertSql(
        this.#state.insertTable!,
        quotedColumns,
        currentRows,
        columns,
        options,
      );
      batches.push({
        sql: built.sql,
        params: built.params,
        paramTypes: built.paramTypes,
        rowCount: currentRows.length,
      });
      currentRows = [];
    };

    for (const row of this.#state.insertRows) {
      const candidateRows = [...currentRows, row];
      const candidateBuilt = this.#buildInsertSql(
        this.#state.insertTable!,
        quotedColumns,
        candidateRows,
        columns,
        options,
      );
      if (
        currentRows.length > 0 &&
        this.#batchWireSize(candidateBuilt, options.usePlaceholders) >
          this.#options.maxRequestBytes
      ) {
        flush();
      }
      currentRows.push(row);
    }

    flush();
    return batches;
  }

  #buildInsertSql(
    table: string,
    quotedColumns: string[],
    rows: Record<string, unknown>[],
    columns: string[],
    options: { usePlaceholders: boolean },
  ): {
    sql: string;
    params: unknown[];
    paramTypes: (NoBugDbDataType | undefined)[];
  } {
    const params: unknown[] = [];
    const paramTypes: (NoBugDbDataType | undefined)[] = [];
    const valueGroups = rows.map((row) => {
      const values = columns.map((column) => {
        const value = row[column];
        if (options.usePlaceholders) {
          params.push(value);
          paramTypes.push(this.#options.columnTypes?.[column]);
          return `$${params.length}`;
        }
        return escapeLiteral(
          value,
          this.#options.columnTypes?.[column],
          this.#options.typeMapper,
        );
      });
      return `(${values.join(', ')})`;
    });
    const sql = `INSERT INTO ${quoteIdent(table)} (${quotedColumns.join(', ')}) VALUES ${valueGroups.join(', ')}`;
    assertSupportedSqlFragment(sql);
    return { sql, params, paramTypes };
  }

  #batchWireSize(
    built: {
      sql: string;
      params: unknown[];
      paramTypes: (NoBugDbDataType | undefined)[];
    },
    usePlaceholders: boolean,
  ): number {
    if (!usePlaceholders) {
      return this.#wireSize(built.sql);
    }

    const args = built.params.map((param, index) =>
      escapeLiteral(
        param,
        built.paramTypes[index],
        this.#options.typeMapper,
      ),
    );
    const executeSql =
      args.length > 0 ? `EXECUTE batch(${args.join(', ')})` : 'EXECUTE batch';
    const prepareSql = `PREPARE batch AS ${built.sql}`;
    return Math.max(this.#wireSize(prepareSql), this.#wireSize(executeSql));
  }

  #wireSize(sql: string): number {
    return Buffer.byteLength(`QUERY|${sql}\n`, 'utf8');
  }

  #assertRequestSize(sql: string): void {
    const size = this.#wireSize(sql);
    if (size > this.#options.maxRequestBytes) {
      throw new NoBugDbError(
        'REQUEST_TOO_LARGE',
        `SQL request is ${size} bytes; max is ${this.#options.maxRequestBytes}`,
        { sql },
      );
    }
  }

  #mapRows<T>(result: QueryResult): T[] {
    const { columns, rows } = result;
    const columnTypes = this.#options.columnTypes;
    const mapper = this.#options.typeMapper;

    return rows.map((row) => {
      const record: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        const column = columns[i]!;
        const raw = row[i] ?? null;
        const type = columnTypes?.[column];
        record[column] =
          type !== undefined
            ? mapper.fromWire(raw === '' ? null : raw, type)
            : raw;
      }
      return record as T;
    });
  }
}

function createEmptyState(): QueryBuilderState {
  return {
    kind: null,
    selectColumns: [],
    distinct: false,
    joins: [],
    groupBy: [],
    orderBy: [],
    insertRows: [],
  };
}

function cloneState(state: QueryBuilderState): QueryBuilderState {
  return {
    ...state,
    selectColumns: [...state.selectColumns],
    joins: state.joins.map((join) => ({ ...join })),
    groupBy: [...state.groupBy],
    orderBy: [...state.orderBy],
    insertRows: [...state.insertRows],
    ...(state.setOperation !== undefined
      ? {
          setOperation: {
            left: cloneState(state.setOperation.left),
            steps: state.setOperation.steps.map((step) => ({
              kind: step.kind,
              ...(step.all !== undefined ? { all: step.all } : {}),
              right: cloneState(step.right),
            })),
          },
        }
      : {}),
  };
}

function appendOrderLimitOffset(
  parts: string[],
  state: QueryBuilderState,
): void {
  if (state.orderBy.length > 0) {
    const order = state.orderBy
      .map(({ column, dir }) => `${quoteQualifiedIdent(column)} ${dir}`)
      .join(', ');
    parts.push(`ORDER BY ${order}`);
  }
  if (state.limit !== undefined) {
    parts.push(`LIMIT ${state.limit}`);
  }
  if (state.offset !== undefined) {
    parts.push(`OFFSET ${state.offset}`);
  }
}

function setOperationKeyword(step: SetOperationStep): string {
  if (step.kind === 'union') {
    return step.all === true ? 'UNION ALL' : 'UNION';
  }
  if (step.kind === 'intersect') {
    return 'INTERSECT';
  }
  return 'EXCEPT';
}

function renumberPlaceholders(sql: string, offset: number): string {
  if (offset === 0) {
    return sql;
  }
  return sql.replace(/\$(\d+)/g, (_match, digits: string) => {
    return `$${Number(digits) + offset}`;
  });
}
