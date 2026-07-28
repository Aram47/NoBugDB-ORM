import { describe, expect, it } from 'vitest';
import { IdentityMap } from '../../../src/entity-manager/identity-map.js';
import { UnitOfWork } from '../../../src/entity-manager/unit-of-work.js';
import { defineEntity } from '../../../src/metadata/define-entity.js';
import { EntityMapper } from '../../../src/metadata/entity-mapper.js';

interface User {
  id: string;
  email: string;
  name: string;
}

const UserMeta = defineEntity<User>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'UUID', primary: true },
    email: { type: 'STRING' },
    name: { type: 'STRING' },
  },
});

function createUow(): UnitOfWork {
  return new UnitOfWork(new IdentityMap(), new EntityMapper());
}

describe('UnitOfWork', () => {
  it('tracks new entities and includes them in flush plan inserts', () => {
    const uow = createUow();
    const user: User = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.c',
      name: 'Ada',
    };

    uow.persist(user, UserMeta);
    const plan = uow.getFlushPlan();
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
  });

  it('detects dirty managed entities for update', () => {
    const uow = createUow();
    const user: User = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.c',
      name: 'Ada',
    };

    uow.registerManaged(user, UserMeta);
    user.name = 'Grace';

    const plan = uow.getFlushPlan();
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.entity).toBe(user);
  });

  it('schedules deletes and drops new entities on remove', () => {
    const uow = createUow();
    const managed: User = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.c',
      name: 'Ada',
    };
    const neu: User = {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'b@c.d',
      name: 'Bob',
    };

    uow.registerManaged(managed, UserMeta);
    uow.persist(neu, UserMeta);
    uow.remove(managed);
    uow.remove(neu);

    const plan = uow.getFlushPlan();
    expect(plan.deletes).toHaveLength(1);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.deletes[0]?.entity).toBe(managed);
  });

  it('returns the same identity-map reference on re-register', () => {
    const uow = createUow();
    const first: User = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.c',
      name: 'Ada',
    };
    const second: User = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.c',
      name: 'Ada2',
    };

    const managed = uow.registerManaged(first, UserMeta);
    const again = uow.registerManaged(second, UserMeta);

    expect(again).toBe(managed);
    expect(again.name).toBe('Ada2');
  });

  it('flush order is inserts then updates then deletes', () => {
    const uow = createUow();
    const neu: User = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'n@e.w',
      name: 'New',
    };
    const dirty: User = {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'd@i.r',
      name: 'Dirty',
    };
    const gone: User = {
      id: '33333333-3333-4333-8333-333333333333',
      email: 'g@o.n',
      name: 'Gone',
    };

    uow.registerManaged(dirty, UserMeta);
    uow.registerManaged(gone, UserMeta);
    dirty.name = 'Changed';
    uow.persist(neu, UserMeta);
    uow.remove(gone);

    const plan = uow.getFlushPlan();
    expect(plan.inserts[0]?.entity).toBe(neu);
    expect(plan.updates[0]?.entity).toBe(dirty);
    expect(plan.deletes[0]?.entity).toBe(gone);
  });
});
