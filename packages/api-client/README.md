# API client

Run builds and type checks from the repository root through Turborepo:

```sh
bunx turbo run build typecheck --filter=@nunio/api-client
```

Turborepo generates `src/schema.d.ts` from the committed API contract before either task. When running package scripts directly, run `bun run generate` first.
