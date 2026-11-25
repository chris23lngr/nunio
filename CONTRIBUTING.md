# Contributing

Commit messages and agent guidelines are in [AGENTS.md](AGENTS.md).

## Local development environment

`docker-compose.dev.yml` runs the web app, API, Postgres, Temporal, the Temporal worker and the Integration fakes on your machine, so you can try a branch before merging. It uses throwaway dev values only and never talks to staging or production.

Not included: the parser and object storage, so Source uploads and ingestion do not work. Email is not sent either.

### Prerequisites

- Docker with Compose v2
- [Bun](https://bun.sh), for the `bun run dev:*` shortcuts below
- Host names for the app and API origins, which must be separate origins under one domain ([ADR-0005](docs/adr/0005-separate-app-and-api-origins.md)), and for the Integration fakes. The e2e suite uses the same names, so you may have some already:

  ```sh
  echo "127.0.0.1 app.nunio.test api.nunio.test mail.nunio.test mcp.nunio.test" | sudo tee -a /etc/hosts
  ```

### Start

```sh
bun run dev:up:build
```

The services run in the background. The first build takes a few minutes. When it settles:

| What        | Where                                    |
| ----------- | ---------------------------------------- |
| Web app     | <http://app.nunio.test:3000>             |
| API         | <http://api.nunio.test:3001> (`/health`) |
| Temporal UI | <http://localhost:8233>                  |

The stack runs with `INTEGRATION_FAKES` on, and its migrate step offers Email and Testnotizen in Einstellungen › Verbindungen. Testnotizen is a fake MCP server at <http://mcp.nunio.test:3002>. A GreenMail server at `mail.nunio.test` stands in for a university mailbox and takes any address with any password. It serves IMAP over TLS on 8993 and SMTP over TLS on 8465, as in the e2e suite, which the host reaches on 3993 and 3465. Its certificate comes from a dev CA in the `mail-certs` volume, which the API and worker trust.

### Create an account

Sign-up needs an invitation. No email leaves the local stack: the API writes each sign-in code to its log instead. Issue an invitation:

```sh
docker compose -f docker-compose.dev.yml exec -w /app/packages/identity \
  -e OPERATOR_ID=dev -e APP_ORIGIN=http://app.nunio.test:3000 \
  -e INVITATION_DATABASE_URL=postgresql://nunio:nunio@db:5432/nunio \
  api node --import tsx src/invite.ts you@example.com
```

Open the `url` it prints, enter your name and select "Code senden". Then read the code from the API log:

```sh
docker compose -f docker-compose.dev.yml logs api | grep Anmeldecode
```

Later sign-ins work the same way: request a code on the sign-in page and read it from the log.

### Everyday use

- **Start again** with the existing image: `bun run dev:up`.
- **Code changes:** the apps run from a built image, so rebuild after editing: `bun run dev:up:build`.
- **AI features** are off. To enable them, put `OPENROUTER_API_KEY=...` and `AI_DISABLED=false` in a git-ignored `.env` file next to the compose file.
- **Stop:** `bun run dev:down`. This keeps the database and Temporal state; to delete them too, run `docker compose -f docker-compose.dev.yml down -v`.

### Automated tests

`bun install`, then `bunx turbo run lint typecheck test`. The browser suites are described in [apps/web/README.md](apps/web/README.md) and `apps/e2e`.
