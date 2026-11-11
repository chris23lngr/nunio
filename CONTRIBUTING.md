# Contributing

Commit messages and agent guidelines are in [AGENTS.md](AGENTS.md).

## Local development environment

`docker-compose.dev.yml` runs the web app, API, Postgres, Temporal and the Temporal worker on your machine, so you can try a branch before merging. It uses throwaway dev values only and never talks to staging or production.

Not included: the parser and object storage, so Source uploads and ingestion do not work. Email is not sent either.

### Prerequisites

- Docker with Compose v2
- [Bun](https://bun.sh), for the `bun run dev:*` shortcuts below
- Host names for the app and API origins, which must be separate origins under one domain ([ADR-0005](docs/adr/0005-separate-app-and-api-origins.md)). The e2e suite uses the same names, so you may have them already:

  ```sh
  echo "127.0.0.1 app.nunio.test api.nunio.test" | sudo tee -a /etc/hosts
  ```

### Start

```sh
bun run dev:up:build
```

The services run in the background. The first build takes a few minutes. When it settles:

| What | Where |
| --- | --- |
| Web app | <http://app.nunio.test:3000> |
| API | <http://api.nunio.test:3001> (`/health`) |
| Temporal UI | <http://localhost:8233> |

### Create an account

Sign-up needs an invitation and a verified email, and no email arrives locally. Issue an invitation, sign up with it, then mark the account verified by hand:

```sh
docker compose -f docker-compose.dev.yml exec -w /app/packages/identity \
  -e OPERATOR_ID=dev -e APP_ORIGIN=http://app.nunio.test:3000 \
  -e INVITATION_DATABASE_URL=postgresql://nunio:nunio@db:5432/nunio \
  api node --import tsx src/invite.ts you@example.com
```

Open the `url` it prints and sign up with that address. The verification email cannot be delivered, so instead run:

```sh
docker compose -f docker-compose.dev.yml exec db psql -U nunio -d nunio \
  -c "UPDATE \"user\" SET \"emailVerified\" = true WHERE email = 'you@example.com'"
```

Now sign in.

### Everyday use

- **Start again** with the existing image: `bun run dev:up`.
- **Code changes:** the apps run from a built image, so rebuild after editing: `bun run dev:up:build`.
- **AI features** are off. To enable them, put `OPENROUTER_API_KEY=...` and `AI_DISABLED=false` in a git-ignored `.env` file next to the compose file.
- **Stop:** `bun run dev:down`. This keeps the database and Temporal state; to delete them too, run `docker compose -f docker-compose.dev.yml down -v`.

### Automated tests

`bun install`, then `bunx turbo run lint typecheck test`. The browser suites are described in [apps/web/README.md](apps/web/README.md) and `apps/e2e`.
