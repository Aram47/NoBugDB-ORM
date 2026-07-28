/** Public package version (semver). */
export const VERSION = '0.1.1';

export {
  Client,
  Connection,
  NoBugDbError,
} from './driver/index.js';
export type {
  ConnectionOptions,
  NoBugDbErrorCode,
  QueryResult,
} from './driver/index.js';
export { Pool, PooledConnection } from './pool/index.js';
export type { PoolOptions } from './pool/index.js';
export {
  TypeMapper,
  defaultTypeMapper,
  isValidDateString,
  isValidUuid,
} from './types/index.js';
export type { NoBugDbDataType } from './types/index.js';
export {
  QueryBuilder,
  quoteIdent,
  escapeLiteral,
  sql,
  runPrepared,
} from './query-builder/index.js';
export type {
  QueryBuilderOptions,
  QueryExecutor,
  WhereInput,
  SqlExpression,
  SqlRaw,
  PreparedRunOptions,
} from './query-builder/index.js';

export {
  defineEntity,
  EntityMapper,
  MetadataRegistry,
  SchemaRegistry,
  ENTITY_METADATA,
  isEntityMetadata,
  MAX_RELATION_DEPTH,
  parseRelationPaths,
} from './metadata/index.js';
export type {
  ColumnMetadata,
  ColumnOptions,
  EntityMetadata,
  EntitySchema,
  EntityMapperOptions,
  RelationKind,
  RelationMetadata,
  RelationOnDelete,
  RelationOptions,
  TableMetadata,
  RelationPathNode,
} from './metadata/index.js';

export {
  EntityManager,
  IdentityMap,
  UnitOfWork,
} from './entity-manager/index.js';
export type {
  EntityManagerDeps,
  EntityManagerOptions,
  EntityState,
  FlushPlan,
  TrackedEntity,
} from './entity-manager/index.js';

export { Repository } from './repository/index.js';
export type { FindOptions, RepositoryContext } from './repository/index.js';

export { DataSource } from './data-source/index.js';
export type { DataSourceOptions } from './data-source/index.js';

export {
  Migrator,
  createMigrationContext,
  DEFAULT_HISTORY_TABLE,
  loadMigrations,
  listMigrationFiles,
  migrationIdFromFilename,
  isMigrationFilename,
} from './migrations/index.js';
export type {
  ColumnBuilder,
  FkOptions,
  FkReferentialAction,
  AlterTableBuilder,
  MigrationBuilder,
  MigrationContext,
  MigrationModule,
  MigrationStatusEntry,
  MigratorOptions,
  TableBuilder,
} from './migrations/index.js';
