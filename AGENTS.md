# Agent instructions

## Commits

- Write [Conventional Commits](https://www.conventionalcommits.org): `type(scope): subject`, for example `feat(api): verify webhook signatures`.
- Keep the body to at most two sentences that say why; the diff already shows what.
- Credit only people. Commits carry no AI attribution: no `Co-Authored-By` trailer or "Generated with" line for an agent or tool.

`packages/commitlint-config` is the source of truth. The `commit-msg` hook (installed by `bun install`) and the CI `commits` job enforce it.
