import { NoBugDbError } from '../driver/errors.js';
import type { EntityManager } from '../entity-manager/entity-manager.js';
import type { DataSource } from '../data-source/data-source.js';
import { DEFAULT_EM_PROPERTY, type ExpressOrmOptions, type ExpressRequestLike, type ExpressResponseLike } from './types.js';

const EM_PROPERTY_BY_REQUEST = new WeakMap<object, string>();
const DATA_SOURCE_LOCAL_KEY = 'nobugdb-orm-dataSource';

function getPropertyName(req: ExpressRequestLike): string {
  return EM_PROPERTY_BY_REQUEST.get(req) ?? DEFAULT_EM_PROPERTY;
}

function setPropertyName(req: ExpressRequestLike, property: string): void {
  EM_PROPERTY_BY_REQUEST.set(req, property);
}

/**
 * Build a request-scoped EntityManager (fresh Identity Map per request).
 * We bind it to the pool executor so each query uses its own pooled connection.
 */
function createRequestEm(ds: DataSource): EntityManager {
  return ds.manager.withExecutor(ds.pool);
}

async function waitForResponseEnd(res: ExpressResponseLike): Promise<number> {
  await new Promise<void>((resolve) => {
    res.once('finish', () => resolve());
    res.once('close', () => resolve());
  });
  return res.statusCode ?? 200;
}

/**
 * Minimal graceful shutdown helper:
 * - server.close() to stop accepting
 * - ds.destroy() to stop pool
 */
export async function gracefulShutdown(
  ds: DataSource,
  server: { close: (cb: (err?: Error) => void) => void },
): Promise<void> {
  const closePromise = new Promise<void>((resolve, reject) => {
    server.close((err?: Error) => (err ? reject(err) : resolve()));
  });

  await ds.destroy();
  await closePromise;
}

/**
 * Store a {@link DataSource} on `app.locals` for later lookup in handlers.
 */
export function attachDataSource(
  app: { locals: Record<string, unknown> },
  ds: DataSource,
): void {
  app.locals[DATA_SOURCE_LOCAL_KEY] = ds;
}

/**
 * Read the request-scoped {@link EntityManager} mounted by {@link nobugdbMiddleware}.
 * @throws {NoBugDbError} when middleware was not applied to this request
 */
export function getEntityManager(req: ExpressRequestLike): EntityManager {
  const property = getPropertyName(req);
  const em = req[property] as EntityManager | undefined;
  if (!em) {
    throw new NoBugDbError(
      'EXPRESS_EM_MISSING',
      "EntityManager is missing on request; did you mount nobugdbMiddleware?",
    );
  }
  return em;
}

/**
 * Express middleware that attaches a request-scoped {@link EntityManager}
 * (fresh Identity Map per request) at `req.em` by default.
 *
 * With `perRequestTransaction: true`, the whole request shares one sticky
 * TCP transaction: commit on non-5xx responses, rollback on 5xx or errors.
 */
export function nobugdbMiddleware(options: ExpressOrmOptions) {
  const property = options.property ?? DEFAULT_EM_PROPERTY;
  const ds = options.dataSource;
  const perRequestTransaction = options.perRequestTransaction === true;

  return async function middleware(
    req: ExpressRequestLike,
    res: ExpressResponseLike,
    next: (err?: unknown) => void,
  ): Promise<void> {
    if (!perRequestTransaction) {
      const em = createRequestEm(ds);
      setPropertyName(req, property);
      req[property] = em;
      next();
      return;
    }

    // Transaction lifecycle:
    // - BEGIN immediately
    // - handler chain executes
    // - commit/rollback is decided on response end (finish/close)
    const conn = await ds.pool.acquire();
    let txStarted = false;

    try {
      await conn.query('BEGIN');
      txStarted = true;

      const txEm = ds.manager.withExecutor(conn);
      setPropertyName(req, property);
      req[property] = txEm;

      // Register before next() so early finish/close is not missed.
      const endPromise = waitForResponseEnd(res);
      next();

      const statusCode = await endPromise;
      if (statusCode >= 500) {
        await conn.query('ROLLBACK');
      } else {
        await conn.query('COMMIT');
      }

      conn.release();
    } catch (err) {
      // Best-effort rollback if we managed to start tx.
      if (txStarted) {
        try {
          await conn.query('ROLLBACK');
        } catch {
          // ignore rollback failures; connection may be in uncertain state
        }
      }

      try {
        conn.destroy();
      } catch {
        // ignore destroy errors
      }

      next(err);
    }
  };
}

