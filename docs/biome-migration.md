# Biome migration

Biome 2.6.3 replaces ESLint for all workspaces and enables formatting across the
repository. This work uses Matt Pocock's `research` skill to check rule coverage
against official sources and the installed version's schema.

## Commands and configuration

- `bun run lint`: check lint rules, formatting, and import organization across the
  repository, including root files. CI runs this same command without affected
  filtering; Biome checks the whole repository in a fraction of a second locally.
- `bun run format`: apply formatting. `bun run format:check`: check it without
  writing. Run `bunx biome check --write .` to also apply safe lint/import fixes.
- Workspace `lint` scripts run `biome check .`, so filtered Turbo invocations still
  work. Turbo's lint inputs include the root `biome.json` to invalidate cached
  results when shared rules change.
- The root config uses two spaces, double quotes, and semicolons. The UI package
  extends it with its existing semicolon-free style, Tailwind class sorting, and
  Tailwind stylesheet. Web extends it with explicit Next and React domains.

Biome's recommended preset is the baseline; it is not identical to ESLint's
recommended presets. [CLI](https://biomejs.dev/reference/cli/),
[nested configuration](https://biomejs.dev/configuration/big-projects/),
[domains](https://biomejs.dev/linter/domains/),
[versioned configuration schema](https://biomejs.dev/schemas/2.6.3/schema.json).

## Preserved guards and coverage gaps

The shared config explicitly retains workspace import restrictions using
`noRestrictedImports` with the original patterns (`../../*` and
`**/packages/*/src/**`). `useImportType` runs at error severity with
`separatedType`, and JS files retain undeclared-variable checking. TypeScript
continues to use `tsc` for that check.
[Import restrictions](https://biomejs.dev/linter/rules/no-restricted-imports/),
[type imports](https://biomejs.dev/linter/rules/use-import-type/),
[undeclared variables](https://biomejs.dev/linter/rules/no-undeclared-variables/).

Web explicitly enables the mapped checks for synchronous scripts, async client
components, beforeInteractive script placement, inline script IDs, hook order,
and hook dependencies. Recommended Next rules cover additional document/head,
image, polyfill, and font checks.
[Next rule mappings](https://biomejs.dev/linter/javascript/sources/#nexteslint-plugin-next),
[Next preset source](https://github.com/vercel/next.js/blob/v16.4.3/packages/eslint-plugin-next/src/index.ts).

Complete ESLint removal accepts these known differences:

- No mapped equivalent for Next's `no-html-link-for-pages`, `no-css-tags`,
  `no-duplicate-head`, `no-assign-module-variable`, `no-page-custom-font`,
  `no-styled-jsx-in-document`, `no-title-in-document-head`,
  `no-script-component-in-head`, `no-typos`, or
  `no-location-assign-relative-destination`.
- The Google Analytics rule shown in newer Biome docs is absent from 2.6.3.
- Biome's hook order/dependency checks do not replace the full React Compiler
  ESLint suite (purity, immutability, refs, compiler configuration, and others).
- `useImportType` does not exactly reproduce every option of
  `consistent-type-imports`, including restrictions on inline `import()` types.

Sources: [Biome mappings](https://biomejs.dev/linter/javascript/sources/),
[React's recommended rules](https://react.dev/reference/eslint-plugin-react-hooks),
[Biome 2.6.3 type-import implementation](https://github.com/biomejs/biome/blob/%40biomejs/biome%402.6.3/crates/biome_js_analyze/src/lint/style/use_import_type.rs),
[typescript-eslint options](https://typescript-eslint.io/rules/consistent-type-imports/).

## Deliberate exceptions

- Build output, coverage, generated source/declarations, and the generated OpenAPI
  contract are excluded. Generated design tokens remain formatted by their
  existing generation command.
- Agent instruction/skill files keep their existing formatting.
- `docs/design/delegation-gate.md` is excluded from formatting because its table
  oscillates between two layouts on consecutive Biome 2.6.3 runs.
- E2E disables `usePlaywrightValidDescribeCallback`: Biome 2.6.3 rejects the valid
  `test.describe(title, { tag }, callback)` overload used in staging tests.
  [Playwright overload](https://playwright.dev/docs/api/class-test#test-describe).
- Non-null assertions remain allowed outside UI, matching the previous shared
  lint policy. UI retains its existing warning. Existing hook refresh dependencies
  remain warnings; removing them would change application behavior.

## Verification

- Frozen-lockfile installation passes, with no ESLint dependencies remaining.
- Repository lint and formatting checks pass; a second formatter run writes no
  changes. Six warnings and one informational diagnostic remain nonblocking.
- Typecheck passes (31 Turbo tasks), run with `--concurrency=1` to avoid the
  existing web build/type-generation race on a fresh checkout. Formatting required
  moving one `@ts-expect-error` comment onto its newly wrapped argument.
- Workspace tests pass (330 tests across 49 files; 27 Turbo tasks including
  prerequisite builds). This includes real database, Temporal, and Storybook
  browser tests; the separate E2E suite was not run.
- Temporary probes confirm both restricted import patterns, type-only imports,
  allowed workspace imports, undeclared JS names, conditional hooks, and sync
  scripts. Changing only the root config changes all 19 workspace lint hashes.
- OpenAPI and token generation both reproduce their committed artifacts.
