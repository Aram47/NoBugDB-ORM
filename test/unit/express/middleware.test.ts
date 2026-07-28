import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  handleDefaultQuery,
  sqlFromQuery,
  startMockServer,
} from '../../helpers/mock-tcp-server.js';
import { DataSource } from '../../../src/data-source/data-source.js';
import {
  getEntityManager,
  nobugdbMiddleware,
} from '../../../src/express/index.js';
import type { ExpressRequestLike, ExpressResponseLike } from '../../../src/express/types.js';
import { NoBugDbError } from '../../../src/driver/errors.js';

function createRes(statusCode = 200): ExpressResponseLike & EventEmitter {
  const res = new EventEmitter() as ExpressResponseLike & EventEmitter;
  res.statusCode = statusCode;
  return res;
}

describe('Express integration (nobugdb-orm/express)', () => {
  it('getEntityManager throws if middleware missing', () => {
    expect(() => getEntityManager({} as ExpressRequestLike)).toThrow(
      new NoBugDbError(
        'EXPRESS_EM_MISSING',
        'EntityManager is missing on request; did you mount nobugdbMiddleware?',
      ),
    );
  });

  it('sets request-scoped em with isolated identity map per request', async () => {
    const server = await startMockServer(handleDefaultQuery);
    const ds = new DataSource({ host: server.host, port: server.port });
    await ds.initialize();

    const middleware = nobugdbMiddleware({ dataSource: ds });

    const req1 = {} as ExpressRequestLike;
    const req2 = {} as ExpressRequestLike;
    const res1 = createRes(200);
    const res2 = createRes(200);

    const nextCalls: unknown[] = [];
    const next = (err?: unknown) => nextCalls.push(err);

    await middleware(req1, res1, next);
    await middleware(req2, res2, next);

    const em1 = getEntityManager(req1);
    const em2 = getEntityManager(req2);

    expect(em1).not.toBe(em2);
    expect(em1.unitOfWork.identityMap).not.toBe(em2.unitOfWork.identityMap);

    await ds.destroy();
    await server.close();
  });

  it('perRequestTransaction commits on successful response', async () => {
    const server = await startMockServer(handleDefaultQuery);
    const ds = new DataSource({ host: server.host, port: server.port });
    await ds.initialize();

    const middleware = nobugdbMiddleware({
      dataSource: ds,
      perRequestTransaction: true,
    });

    const req = {} as ExpressRequestLike;
    const res = createRes(200);
    const nextCalls: unknown[] = [];
    let resolveNext!: () => void;
    const nextCalled = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
    const next = (err?: unknown) => {
      nextCalls.push(err);
      resolveNext();
    };

    const promise = middleware(req, res, next);
    await nextCalled;
    res.emit('finish');
    await promise;

    const queries = server.requestLog
      .filter((r) => r.startsWith('QUERY|'))
      .map((r) => sqlFromQuery(r).toUpperCase());
    expect(queries).toEqual(['BEGIN', 'COMMIT']);

    await ds.destroy();
    await server.close();
  });

  it('perRequestTransaction rolls back on error response', async () => {
    const server = await startMockServer(handleDefaultQuery);
    const ds = new DataSource({ host: server.host, port: server.port });
    await ds.initialize();

    const middleware = nobugdbMiddleware({
      dataSource: ds,
      perRequestTransaction: true,
    });

    const req = {} as ExpressRequestLike;
    const res = createRes(500);
    const nextCalls: unknown[] = [];
    let resolveNext!: () => void;
    const nextCalled = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
    const next = (err?: unknown) => {
      nextCalls.push(err);
      resolveNext();
    };

    const promise = middleware(req, res, next);
    await nextCalled;
    res.emit('finish');
    await promise;

    const queries = server.requestLog
      .filter((r) => r.startsWith('QUERY|'))
      .map((r) => sqlFromQuery(r).toUpperCase());
    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);

    await ds.destroy();
    await server.close();
  });
});

