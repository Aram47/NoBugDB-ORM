import { describe, expect, it } from 'vitest';
import { TableBuilderImpl } from '../../../src/migrations/ddl/table-builder.js';
import {
  generateCreateIndexSql,
  generateCreateTableSql,
  generateCreateViewSql,
  generateDropIndexSql,
  generateDropTableSql,
  generateDropViewSql,
} from '../../../src/migrations/ddl/sql-generator.js';
import { AlterTableBuilderImpl } from '../../../src/migrations/ddl/alter-table-builder.js';

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
    alter.setNotNull('email');
    alter.dropNotNull('bio');

    expect(alter.getStatements()).toEqual([
      'ALTER TABLE users ADD COLUMN age INT NOT NULL',
      'ALTER TABLE users DROP COLUMN legacy',
      'ALTER TABLE users RENAME COLUMN name TO full_name',
      'ALTER TABLE users ADD PRIMARY KEY (id)',
      'ALTER TABLE users ADD UNIQUE (email)',
      'ALTER TABLE users ALTER COLUMN email SET NOT NULL',
      'ALTER TABLE users ALTER COLUMN bio DROP NOT NULL',
    ]);
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
});
