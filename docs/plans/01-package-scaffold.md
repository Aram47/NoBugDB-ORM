# Phase 1 — Package Scaffold

## Goal

Поднять каркас npm-пакета `nobugdb-orm` на TypeScript с dual ESM/CJS, линтером, тестами и пустой структурой `src/`, готовой к фазе 2.

## Depends on

- [00-overview.md](./00-overview.md)

## Public API (draft after this phase)

Пока только placeholder:

```ts
export const VERSION = '0.0.0';
```

Реальные экспорты появятся в фазах 2–8.

## Target layout

```text
NoBugDB-ORM/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.cjs.json          # optional separate CJS build
├── vitest.config.ts
├── eslint.config.js
├── .npmignore
├── README.md
├── src/
│   ├── index.ts
│   ├── protocol/              # phase 2
│   ├── driver/                # phase 2
│   ├── pool/                  # phase 3
│   ├── types/                 # phase 4
│   ├── query-builder/         # phase 4
│   ├── metadata/              # phase 5–6
│   ├── repository/            # phase 5
│   ├── entity-manager/        # phase 5
│   ├── migrations/            # phase 7
│   └── express/               # phase 8
├── test/
│   └── unit/
└── docs/plans/
```

Папки слоёв можно создать пустыми с `.gitkeep` или добавить при старте соответствующей фазы — предпочесть **создавать по мере фазы** (YAGNI).

## Implementation steps

1. **Init package.json**
   - `name`: `nobugdb-orm`
   - `version`: `0.0.0` (или `0.1.0-alpha.0`)
   - `type`: `module`
   - `engines.node`: `>=18`
   - `exports` map: `import` → `./dist/esm/index.js`, `require` → `./dist/cjs/index.js`, `types` → `./dist/esm/index.d.ts`
   - `main` / `module` / `types` для совместимости
   - `files`: `["dist", "README.md", "LICENSE"]`
   - scripts:
     - `build` — tsc ESM + CJS
     - `test` — vitest
     - `lint` — eslint
     - `typecheck` — `tsc --noEmit`
     - `prepublishOnly` — `npm run build`

2. **TypeScript**
   - Strict mode (`strict: true`)
   - `declaration: true`, `sourceMap: true`
   - Target ES2022 / module NodeNext (или ES2020 + bundler — выбрать NodeNext для library)
   - Отдельный CJS emit: `module: CommonJS` + `outDir: dist/cjs` + `package.json` в `dist/cjs` с `"type":"commonjs"`

3. **Tooling**
   - Vitest для unit-тестов
   - ESLint flat config + typescript-eslint
   - Prettier optional — только если уже принят в команде; иначе ESLint достаточно

4. **`.npmignore` / `files`**
   - Не публиковать `src/`, `test/`, `docs/plans/` в tarball (или публиковать `docs` позже — для v1 достаточно README)
   - Исключить `.env`, coverage, tsbuildinfo

5. **LICENSE**
   - MIT (подтвердить на фазе 9 если нужно выровнять с NoBugDB)

6. **Smoke test**
   - `test/unit/version.test.ts` импортирует `VERSION`

## Suggested `package.json` fields (sketch)

```json
{
  "name": "nobugdb-orm",
  "version": "0.0.0",
  "description": "TypeScript Data Mapper ORM for NoBugDB",
  "type": "module",
  "engines": { "node": ">=18" },
  "exports": {
    ".": {
      "types": "./dist/esm/index.d.ts",
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js"
    }
  },
  "scripts": {
    "build": "npm run build:esm && npm run build:cjs",
    "build:esm": "tsc -p tsconfig.build.json",
    "build:cjs": "tsc -p tsconfig.cjs.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  }
}
```

## Tests

- [ ] `npm run typecheck` проходит
- [ ] `npm test` — smoke на `VERSION`
- [ ] `npm run build` создаёт `dist/esm` и `dist/cjs`
- [ ] CJS: `node -e "require('./dist/cjs/index.js')"` работает
- [ ] ESM: `node --input-type=module -e "import('./dist/esm/index.js')"` работает

## Definition of Done

- [ ] Каркас пакета в репозитории
- [ ] Dual build настроен
- [ ] CI-готовые scripts (`test`, `build`, `typecheck`, `lint`)
- [ ] Нет ORM-логики — только scaffold
- [ ] `.gitignore` не блокирует исходники и docs/plans

## Known limitations

- Публичный API минимален до фазы 2+
- Express / migrations CLI bin entry — фазы 7–8
- Integration tests с живым NoBugDB — не обязательны в фазе 1

## Out of scope

- Реализация protocol/driver
- Docker compose для NoBugDB (можно добавить helper в фазе 2 docs)
