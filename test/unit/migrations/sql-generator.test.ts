import { describe, expect, it } from 'vitest';
import { NoBugDbError } from '../../../src/driver/errors.js';
import {
  assertNoForbiddenCheckConstruct,
  assertValidCheckExpression,
  assertValidCheckName,
} from '../../../src/migrations/ddl/check-constraint.js';
import {
  assertValidHashPartitionValues,
  assertValidPartitionColumn,
  assertValidPartitionStrategy,
  assertValidRangePartitionValues,
} from '../../../src/migrations/ddl/partition.js';
import {
  assertRoutineSqlFitsWire,
  assertValidFunctionReturns,
  assertValidFunctionStyle,
  assertValidRoutineBody,
  assertValidRoutineDataType,
  assertValidRoutineName,
  assertValidRoutineParams,
} from '../../../src/migrations/ddl/routine.js';
import {
  assertTriggerSqlFitsWire,
  assertValidTriggerBody,
  assertValidTriggerEvent,
  assertValidTriggerName,
  assertValidTriggerTable,
  assertValidTriggerTiming,
} from '../../../src/migrations/ddl/trigger.js';
import { TableBuilderImpl } from '../../../src/migrations/ddl/table-builder.js';
import {
  generateAddCheckSql,
  generateCallSql,
  generateCreateFunctionSql,
  generateCreateIndexSql,
  generateCreatePartitionSql,
  generateCreatePartitionedTableSql,
  generateCreateProcedureSql,
  generateCreateTableSql,
  generateCreateTriggerSql,
  generateCreateViewSql,
  generateDropCheckSql,
  generateDropFunctionSql,
  generateDropIndexSql,
  generateDropProcedureSql,
  generateDropTableSql,
  generateDropTriggerSql,
  generateDropViewSql,
} from '../../../src/migrations/ddl/sql-generator.js';
import { AlterTableBuilderImpl } from '../../../src/migrations/ddl/alter-table-builder.js';
import { DEFAULT_MAX_REQUEST_BYTES } from '../../../src/driver/types.js';
import type { NoBugDbDataType } from '../../../src/types/type-mapper.js';

describe('sql-generator', () => {
  it('generates CREATE TABLE with PK, UNIQUE, NOT NULL', () => {
    const builder = new TableBuilderImpl();
    builder.uuid('id').primary();
    builder.string('email').unique().notNull();
    builder.string('name').notNull();

    expect(generateCreateTableSql('users', builder.getColumns())).toBe(
      'CREATE TABLE users (id UUID PRIMARY KEY, email STRING UNIQUE NOT NULL, name STRING NOT NULL)',
    );
  });

  it('generates CREATE TABLE with DEFAULT and FK ON DELETE CASCADE', () => {
    const builder = new TableBuilderImpl();
    builder.int('id').primary();
    builder.int('score').default(0);
    builder.int('author_id').references('authors', 'id', { onDelete: 'CASCADE' });

    expect(generateCreateTableSql('posts', builder.getColumns())).toBe(
      'CREATE TABLE posts (id INT PRIMARY KEY, score INT DEFAULT 0, author_id INT REFERENCES authors(id) ON DELETE CASCADE)',
    );
  });

  it('generates CREATE TABLE with FK ON UPDATE SET NULL', () => {
    const builder = new TableBuilderImpl();
    builder.uuid('id').primary();
    builder.uuid('parent_id').references('nodes', 'id', {
      onDelete: 'SET NULL',
      onUpdate: 'SET NULL',
    });

    expect(generateCreateTableSql('nodes', builder.getColumns())).toBe(
      'CREATE TABLE nodes (id UUID PRIMARY KEY, parent_id UUID REFERENCES nodes(id) ON DELETE SET NULL ON UPDATE SET NULL)',
    );
  });

  it('generates CREATE TABLE with column-level and table-level CHECK', () => {
    const builder = new TableBuilderImpl();
    builder.int('id').primary();
    builder.int('price').notNull().check('price >= 0');
    builder.check('chk_range', 'price <= 1000000');

    expect(generateCreateTableSql('products', builder.getColumns(), builder.getChecks())).toBe(
      'CREATE TABLE products (id INT PRIMARY KEY, price INT NOT NULL CHECK (price >= 0), CONSTRAINT chk_range CHECK (price <= 1000000))',
    );
  });

  it('generates DROP TABLE', () => {
    expect(generateDropTableSql('users')).toBe('DROP TABLE users');
  });

  it('generates ALTER TABLE statements', () => {
    const alter = new AlterTableBuilderImpl('users');
    alter.addColumn('age', 'INT', (c) => c.notNull());
    alter.dropColumn('legacy');
    alter.renameColumn('name', 'full_name');
    alter.addPrimaryKey('id');
    alter.addUnique('email');
    alter.addUnique('a', 'b');
    alter.dropUnique('a', 'b');
    alter.setNotNull('email');
    alter.dropNotNull('bio');
    alter.addCheck('chk_name', "name <> ''");
    alter.dropCheck('chk_range');

    expect(alter.getStatements()).toEqual([
      'ALTER TABLE users ADD COLUMN age INT NOT NULL',
      'ALTER TABLE users DROP COLUMN legacy',
      'ALTER TABLE users RENAME COLUMN name TO full_name',
      'ALTER TABLE users ADD PRIMARY KEY (id)',
      'ALTER TABLE users ADD UNIQUE (email)',
      'ALTER TABLE users ADD UNIQUE (a, b)',
      'ALTER TABLE users DROP UNIQUE (a, b)',
      'ALTER TABLE users ALTER COLUMN email SET NOT NULL',
      'ALTER TABLE users ALTER COLUMN bio DROP NOT NULL',
      "ALTER TABLE users ADD CONSTRAINT chk_name CHECK (name <> '')",
      'ALTER TABLE users DROP CHECK chk_range',
    ]);
  });

  it('generates CREATE TABLE with composite PRIMARY KEY and UNIQUE', () => {
    const builder = new TableBuilderImpl();
    builder.uuid('order_id').notNull();
    builder.uuid('product_id').notNull();
    builder.int('qty').notNull();
    builder.primaryKey('order_id', 'product_id');
    builder.unique(null, 'order_id', 'product_id');

    expect(
      generateCreateTableSql('order_items', builder.getColumns(), {
        checks: builder.getChecks(),
        primaryKey: builder.getPrimaryKey(),
        uniques: builder.getUniques(),
      }),
    ).toBe(
      'CREATE TABLE order_items (order_id UUID NOT NULL, product_id UUID NOT NULL, qty INT NOT NULL, PRIMARY KEY (order_id, product_id), UNIQUE (order_id, product_id))',
    );
  });

  it('generates ADD COLUMN with column-level CHECK', () => {
    const alter = new AlterTableBuilderImpl('products');
    alter.addColumn('discount', 'INT', (c) => c.check('discount >= 0'));

    expect(alter.getStatements()).toEqual([
      'ALTER TABLE products ADD COLUMN discount INT CHECK (discount >= 0)',
    ]);
  });

  it('generates add/drop CHECK helpers', () => {
    expect(generateAddCheckSql('products', 'chk_name', "name <> ''")).toBe(
      "ALTER TABLE products ADD CONSTRAINT chk_name CHECK (name <> '')",
    );
    expect(generateDropCheckSql('products', 'chk_name')).toBe(
      'ALTER TABLE products DROP CHECK chk_name',
    );
  });

  it('generates index and view DDL', () => {
    expect(generateCreateIndexSql('idx_email', 'users', ['email'])).toBe(
      'CREATE INDEX idx_email ON users (email)',
    );
    expect(generateDropIndexSql('idx_email')).toBe('DROP INDEX idx_email');
    expect(generateCreateViewSql('active_users', 'SELECT id FROM users')).toBe(
      'CREATE VIEW active_users AS SELECT id FROM users',
    );
    expect(generateDropViewSql('active_users')).toBe('DROP VIEW active_users');
  });

  it('rejects empty CHECK name and expression', () => {
    const builder = new TableBuilderImpl();
    expect(() => builder.check('  ', 'price >= 0')).toThrow(NoBugDbError);
    expect(() => builder.int('price').check('')).toThrow(NoBugDbError);

    const alter = new AlterTableBuilderImpl('products');
    expect(() => alter.addCheck('', 'price >= 0')).toThrow(NoBugDbError);
    expect(() => alter.addCheck('chk', '   ')).toThrow(NoBugDbError);
    expect(() => alter.dropCheck('')).toThrow(NoBugDbError);
  });

  it('rejects SELECT/EXISTS in CHECK expression', () => {
    const builder = new TableBuilderImpl();
    expect(() => builder.int('age').check('EXISTS (SELECT 1)')).toThrow(NoBugDbError);
    expect(() => builder.check('chk', 'age IN (SELECT id FROM t)')).toThrow(NoBugDbError);

    const alter = new AlterTableBuilderImpl('people');
    expect(() => alter.addCheck('chk', 'EXISTS (SELECT 1 FROM other)')).toThrow(NoBugDbError);
  });
});

describe('check-constraint validation', () => {
  it('trims valid name and expression', () => {
    expect(assertValidCheckName('  chk_age  ')).toBe('chk_age');
    expect(assertValidCheckExpression('  age >= 0  ')).toBe('age >= 0');
  });

  it('assertNoForbiddenCheckConstruct rejects SELECT and EXISTS', () => {
    expect(() => assertNoForbiddenCheckConstruct('SELECT 1')).toThrow(NoBugDbError);
    expect(() => assertNoForbiddenCheckConstruct('exists (1)')).toThrow(NoBugDbError);
    expect(() => assertNoForbiddenCheckConstruct('age >= 0')).not.toThrow();
  });
});

describe('partitioning SQL', () => {
  it('generates RANGE partitioned parent', () => {
    const builder = new TableBuilderImpl();
    builder.int('id').primary();
    builder.int('y').notNull();

    expect(
      generateCreatePartitionedTableSql('sales', builder.getColumns(), {
        strategy: 'RANGE',
        column: 'y',
      }),
    ).toBe(
      'CREATE TABLE sales (id INT PRIMARY KEY, y INT NOT NULL) PARTITION BY RANGE (y)',
    );
  });

  it('generates HASH partitioned parent', () => {
    const builder = new TableBuilderImpl();
    builder.int('id').primary();
    builder.string('name');

    expect(
      generateCreatePartitionedTableSql('sales_h', builder.getColumns(), {
        strategy: 'HASH',
        column: 'id',
      }),
    ).toBe(
      'CREATE TABLE sales_h (id INT PRIMARY KEY, name STRING) PARTITION BY HASH (id)',
    );
  });

  it('generates RANGE child partition', () => {
    expect(
      generateCreatePartitionSql('sales_2024', 'sales', { from: 2024, to: 2025 }),
    ).toBe(
      'CREATE TABLE sales_2024 PARTITION OF sales FOR VALUES FROM (2024) TO (2025)',
    );
  });

  it('generates HASH child partition', () => {
    expect(
      generateCreatePartitionSql('sales_h0', 'sales_hash', { modulus: 4, remainder: 0 }),
    ).toBe(
      'CREATE TABLE sales_h0 PARTITION OF sales_hash FOR VALUES WITH (MODULUS 4, REMAINDER 0)',
    );
  });

  it('quotes STRING RANGE bounds via escapeLiteral', () => {
    expect(
      generateCreatePartitionSql('sales_a', 'sales', { from: "a'b", to: 'z' }),
    ).toBe(
      "CREATE TABLE sales_a PARTITION OF sales FOR VALUES FROM ('a''b') TO ('z')",
    );
  });

  it('rejects invalid HASH remainder and modulus', () => {
    expect(() =>
      generateCreatePartitionSql('p', 'parent', { modulus: 4, remainder: 4 }),
    ).toThrow(NoBugDbError);
    expect(() =>
      generateCreatePartitionSql('p', 'parent', { modulus: 0, remainder: 0 }),
    ).toThrow(NoBugDbError);
    expect(() =>
      generateCreatePartitionSql('p', 'parent', { modulus: 4, remainder: -1 }),
    ).toThrow(NoBugDbError);
  });

  it('rejects missing RANGE bounds', () => {
    expect(() =>
      generateCreatePartitionSql('p', 'parent', { from: 1, to: null }),
    ).toThrow(NoBugDbError);
    expect(() =>
      generateCreatePartitionSql('p', 'parent', { from: undefined, to: 2 }),
    ).toThrow(NoBugDbError);
  });
});

describe('partition validation', () => {
  it('trims column and accepts strategies', () => {
    expect(assertValidPartitionColumn('  y  ')).toBe('y');
    expect(assertValidPartitionStrategy('RANGE')).toBe('RANGE');
    expect(assertValidPartitionStrategy('HASH')).toBe('HASH');
  });

  it('rejects empty column and unknown strategy', () => {
    expect(() => assertValidPartitionColumn('')).toThrow(NoBugDbError);
    expect(() => assertValidPartitionStrategy('LIST')).toThrow(NoBugDbError);
  });

  it('validates HASH and RANGE values', () => {
    expect(assertValidHashPartitionValues({ modulus: 4, remainder: 3 })).toEqual({
      modulus: 4,
      remainder: 3,
    });
    expect(() => assertValidHashPartitionValues({ modulus: 1.5, remainder: 0 })).toThrow(
      NoBugDbError,
    );
    expect(assertValidRangePartitionValues({ from: 2024, to: 2025 })).toEqual({
      from: 2024,
      to: 2025,
    });
  });
});

describe('trigger SQL', () => {
  it('generates BEFORE INSERT trigger', () => {
    expect(
      generateCreateTriggerSql('trg_users_bi', {
        timing: 'BEFORE',
        event: 'INSERT',
        table: 'users',
        body: 'SET NEW.name = UPPER(NEW.name);',
      }),
    ).toBe(
      'CREATE TRIGGER trg_users_bi BEFORE INSERT ON users FOR EACH ROW EXECUTE $$\n' +
        'SET NEW.name = UPPER(NEW.name);\n' +
        '$$;',
    );
  });

  it('generates AFTER DELETE trigger', () => {
    expect(
      generateCreateTriggerSql('trg_audit_del', {
        timing: 'AFTER',
        event: 'DELETE',
        table: 'users',
        body: 'INSERT INTO audit VALUES (OLD.id);',
      }),
    ).toBe(
      'CREATE TRIGGER trg_audit_del AFTER DELETE ON users FOR EACH ROW EXECUTE $$\n' +
        'INSERT INTO audit VALUES (OLD.id);\n' +
        '$$;',
    );
  });

  it('generates DROP TRIGGER', () => {
    expect(generateDropTriggerSql('trg_users_bi')).toBe('DROP TRIGGER trg_users_bi');
  });

  it('rejects empty name, table, and body', () => {
    expect(() =>
      generateCreateTriggerSql('', {
        timing: 'BEFORE',
        event: 'INSERT',
        table: 'users',
        body: 'SET NEW.x = 1;',
      }),
    ).toThrow(NoBugDbError);
    expect(() =>
      generateCreateTriggerSql('trg', {
        timing: 'BEFORE',
        event: 'INSERT',
        table: '  ',
        body: 'SET NEW.x = 1;',
      }),
    ).toThrow(NoBugDbError);
    expect(() =>
      generateCreateTriggerSql('trg', {
        timing: 'BEFORE',
        event: 'INSERT',
        table: 'users',
        body: '   ',
      }),
    ).toThrow(NoBugDbError);
    expect(() => generateDropTriggerSql('')).toThrow(NoBugDbError);
  });

  it('rejects bad timing and event', () => {
    expect(() =>
      generateCreateTriggerSql('trg', {
        timing: 'INSTEAD OF' as 'BEFORE',
        event: 'INSERT',
        table: 'users',
        body: 'SET NEW.x = 1;',
      }),
    ).toThrow(NoBugDbError);
    expect(() =>
      generateCreateTriggerSql('trg', {
        timing: 'BEFORE',
        event: 'TRUNCATE' as 'DELETE',
        table: 'users',
        body: 'SET NEW.x = 1;',
      }),
    ).toThrow(NoBugDbError);
  });

  it('rejects nested $$ in body', () => {
    expect(() =>
      generateCreateTriggerSql('trg', {
        timing: 'BEFORE',
        event: 'INSERT',
        table: 'users',
        body: 'SET NEW.x = 1; $$ nested',
      }),
    ).toThrow(NoBugDbError);
  });

  it('rejects SQL that exceeds wire buffer', () => {
    const body = `SET NEW.x = ${'1'.repeat(DEFAULT_MAX_REQUEST_BYTES)};`;
    expect(() =>
      generateCreateTriggerSql('trg', {
        timing: 'BEFORE',
        event: 'INSERT',
        table: 'users',
        body,
      }),
    ).toThrow(NoBugDbError);
  });
});

describe('trigger validation', () => {
  it('trims name, table, and body', () => {
    expect(assertValidTriggerName('  trg  ')).toBe('trg');
    expect(assertValidTriggerTable('  users  ')).toBe('users');
    expect(assertValidTriggerBody('  SET NEW.x = 1;  ')).toBe('SET NEW.x = 1;');
  });

  it('accepts timing and event enums', () => {
    expect(assertValidTriggerTiming('BEFORE')).toBe('BEFORE');
    expect(assertValidTriggerTiming('AFTER')).toBe('AFTER');
    expect(assertValidTriggerEvent('INSERT')).toBe('INSERT');
    expect(assertValidTriggerEvent('UPDATE')).toBe('UPDATE');
    expect(assertValidTriggerEvent('DELETE')).toBe('DELETE');
  });

  it('assertTriggerSqlFitsWire rejects oversized payloads', () => {
    expect(() => assertTriggerSqlFitsWire('SELECT 1', 8)).toThrow(NoBugDbError);
    expect(() => assertTriggerSqlFitsWire('SELECT 1')).not.toThrow();
  });
});

describe('routine SQL', () => {
  it('generates CREATE FUNCTION dollar style', () => {
    expect(
      generateCreateFunctionSql('double_it', {
        params: [{ name: 'x', type: 'INT' }],
        returns: 'INT',
        body: 'RETURN x * 2;',
      }),
    ).toBe(
      'CREATE FUNCTION double_it(x INT) RETURNS INT AS $$\n' +
        'RETURN x * 2;\n' +
        '$$;',
    );
  });

  it('generates CREATE FUNCTION expr style', () => {
    expect(
      generateCreateFunctionSql('double_it', {
        params: [{ name: 'x', type: 'INT' }],
        returns: 'INT',
        body: 'x * 2',
        style: 'expr',
      }),
    ).toBe('CREATE FUNCTION double_it(x INT) RETURNS INT AS (x * 2);');
  });

  it('generates CREATE PROCEDURE', () => {
    expect(
      generateCreateProcedureSql('add_user', {
        params: [
          { name: 'uid', type: 'INT' },
          { name: 'uname', type: 'STRING' },
        ],
        body: 'INSERT INTO users VALUES (uid, uname);',
      }),
    ).toBe(
      'CREATE PROCEDURE add_user(uid INT, uname STRING) AS $$\n' +
        'INSERT INTO users VALUES (uid, uname);\n' +
        '$$;',
    );
  });

  it('generates DROP FUNCTION and DROP PROCEDURE', () => {
    expect(generateDropFunctionSql('double_it')).toBe('DROP FUNCTION double_it');
    expect(generateDropProcedureSql('add_user')).toBe('DROP PROCEDURE add_user');
  });

  it('generates CALL with escaped STRING args', () => {
    expect(generateCallSql('add_user', [1, "Ada's"])).toBe(
      "CALL add_user(1, 'Ada''s')",
    );
    expect(generateCallSql('noop')).toBe('CALL noop()');
  });

  it('rejects empty name, empty body, bad type, nested $$', () => {
    expect(() =>
      generateCreateFunctionSql('', {
        params: [],
        returns: 'INT',
        body: 'RETURN 1;',
      }),
    ).toThrow(NoBugDbError);
    expect(() =>
      generateCreateFunctionSql('fn', {
        params: [],
        returns: 'INT',
        body: '   ',
      }),
    ).toThrow(NoBugDbError);
    expect(() =>
      generateCreateFunctionSql('fn', {
        params: [{ name: 'x', type: 'VARCHAR' as NoBugDbDataType }],
        returns: 'INT',
        body: 'RETURN x;',
      }),
    ).toThrow(NoBugDbError);
    expect(() =>
      generateCreateProcedureSql('p', {
        params: [],
        body: 'INSERT INTO t VALUES (1); $$',
      }),
    ).toThrow(NoBugDbError);
    expect(() => generateDropFunctionSql('')).toThrow(NoBugDbError);
    expect(() => generateCallSql('')).toThrow(NoBugDbError);
  });

  it('rejects SQL that exceeds wire buffer', () => {
    const body = `RETURN ${'1'.repeat(DEFAULT_MAX_REQUEST_BYTES)};`;
    expect(() =>
      generateCreateFunctionSql('fn', {
        params: [],
        returns: 'INT',
        body,
      }),
    ).toThrow(NoBugDbError);
  });
});

describe('routine validation', () => {
  it('trims name and body; validates params and style', () => {
    expect(assertValidRoutineName('  fn  ')).toBe('fn');
    expect(assertValidRoutineBody('  RETURN 1;  ')).toBe('RETURN 1;');
    expect(assertValidRoutineDataType('STRING')).toBe('STRING');
    expect(assertValidFunctionReturns('INT')).toBe('INT');
    expect(assertValidFunctionStyle('dollar')).toBe('dollar');
    expect(assertValidFunctionStyle('expr')).toBe('expr');
    expect(
      assertValidRoutineParams([{ name: '  x  ', type: 'INT' }]),
    ).toEqual([{ name: 'x', type: 'INT' }]);
  });

  it('assertRoutineSqlFitsWire rejects oversized payloads', () => {
    expect(() => assertRoutineSqlFitsWire('SELECT 1', 8)).toThrow(NoBugDbError);
    expect(() => assertRoutineSqlFitsWire('SELECT 1')).not.toThrow();
  });
});
