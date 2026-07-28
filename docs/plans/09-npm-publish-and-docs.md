# Phase 9 — npm Publish and Docs

## Goal

Подготовить пакет к публикации в npm: документация, semver, CI, лицензия, publish checklist.

## Depends on

- Фазы 1–8 реализованы достаточно для **0.1.0** (driver + pool + QB + Data Mapper + migrations; Express optional но желателен)

## Documentation deliverables

1. **Root README.md**
   - What is nobugdb-orm
   - Requirements: Node >=18, running NoBugDB
   - Install: `npm install nobugdb-orm`
   - Quickstart: DataSource + defineEntity + Repository
   - Transactions
   - Migrations CLI
   - Express subpath
   - Supported SQL / types table
   - Limitations (4KB buffer, no SERIAL/RETURNING, no LIKE/UNION, UUID PKs, no introspection)
   - Link to NoBugDB engine repo

2. **CHANGELOG.md** — Keep a Changelog format

3. **API reference** — TypeDoc optional; минимум JSDoc на public exports

4. **LICENSE** — MIT (or match NoBugDB)

## package.json publish fields

```json
{
  "name": "nobugdb-orm",
  "version": "0.1.0",
  "description": "TypeScript Data Mapper ORM for NoBugDB",
  "keywords": ["nobugdb", "orm", "typescript", "express", "sql"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Aram47/NoBugDB-ORM.git"
  },
  "bugs": {
    "url": "https://github.com/Aram47/NoBugDB-ORM/issues"
  },
  "homepage": "https://github.com/Aram47/NoBugDB-ORM#readme",
  "license": "MIT",
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"],
  "publishConfig": {
    "access": "public"
  }
}
```

Scoped rename `@nobugdb/orm` — только если создана npm org; до тех пор `nobugdb-orm`.

## Semver policy

| Version | Meaning |
|---------|---------|
| `0.x` | API may break between minors |
| `0.1.0` | First public: driver, pool, QB, Data Mapper CRUD, migrations |
| `1.0.0` | Stable API after real users / Express battle-test |

Breaking changes in 0.x: document in CHANGELOG.

## CI (GitHub Actions)

Workflow `.github/workflows/ci.yml`:

1. On PR / push to `main`:
   - `npm ci`
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
2. Optional job: integration tests with NoBugDB Docker image (if Dockerfile in engine usable)

Publish workflow (manual `workflow_dispatch` or on GitHub Release):

- `npm publish --provenance` (if applicable)
- Need `NPM_TOKEN` secret

## Pre-publish checklist

- [ ] `npm pack --dry-run` — только `dist` + docs, нет `.env` / tests source accidentally large
- [ ] ESM + CJS import smoke
- [ ] `nobugdb-orm migration:status --help` works from packed bin
- [ ] README quickstart verified against local NoBugDB
- [ ] Version bumped, CHANGELOG updated
- [ ] Git tag `v0.1.0`
- [ ] `npm publish`

## Implementation steps

1. Expand root README (replace stub)
2. Add LICENSE + CHANGELOG
3. Add GitHub Actions CI
4. Verify `files` / `.npmignore`
5. Add `prepublishOnly`: `npm run typecheck && npm run test && npm run build`
6. First publish `0.1.0` (human step with npm login)

## Tests / verification

- [ ] CI green on clean clone
- [ ] Packed tarball installs in empty dir and types resolve
- [ ] Express peerDep warning acceptable when express missing; core still works

## Definition of Done

- [ ] Package published or ready-to-publish with checklist completed
- [ ] README covers DX and limitations honestly
- [ ] CI protects `main`
- [ ] Plans folder остаётся в git как roadmap (не в npm tarball)

## Known limitations

- npm org scope optional
- Provenance / OIDC publish depends on GitHub-npm setup
- Integration CI needs Docker access to build/run NoBugDB

## Out of scope

- Marketing website
- Paid support tiers
