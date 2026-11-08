# @nunio/ui

Shared React components, design tokens, and Tailwind v4 styles migrated from the
local `nui` repository. Components, stories, token inputs, and reference docs were
copied from its working tree, including uncommitted additions.

## Use in an app

Add `@nunio/ui` as a `workspace:*` dependency. Import the stylesheet once in the
app's root layout and enable `@tailwindcss/postcss` in the app's PostCSS config.
`apps/web` already has this wiring. The stylesheet explicitly includes library
component classes in Tailwind's source scanning.

```tsx
import "@nunio/ui/styles.css"
import { Button } from "@nunio/ui/components/button"
// Named exports are also available from "@nunio/ui".

export function Example() {
  return <Button variant="primary">Continue</Button>
}
```

Apply the `dark` class to an ancestor to switch themes. Keep the application root
in an isolated stacking context (`className="isolate"`) for Base UI portals.
The stylesheet includes Tailwind Preflight and the library's body defaults.
React and React DOM are peer dependencies, supplied by the consuming app.

## Development

Run these commands from the repository root:

```sh
bun run --cwd packages/ui storybook
bun run --cwd packages/ui tokens
bunx turbo run build typecheck lint test --filter=@nunio/ui
bunx turbo run build-storybook --filter=@nunio/ui
```

Install Chromium before running the story tests on a new machine:

```sh
bunx playwright install chromium
```

The package compiles JavaScript and declarations to `dist`; build it before
consuming components. The normal workspace build orders this automatically.
After component changes, rebuild the package while developing the consuming app.
CSS is exported directly from `src/styles` so PostCSS can process it in the app.

- `src/components/ui`: components and their interaction/style stories.
- `src/foundations`: color token and class-merging stories.
- `.storybook`, `vite.config.ts`, `vitest.config.ts`: component explorer and
  Chromium tests, including the existing accessibility checks.
- `src/styles`: global theme and generated light/dark tokens.
- `scripts/build-tokens.ts`: generates tokens from `docs/notion-spec/raw-tokens.txt`.
- `docs/notion-spec`: original component specifications and reference captures.

Run `tokens` after changing the token input and commit the generated CSS. This
package extends the root Biome configuration for linting/formatting, keeps its
semicolon-free style and Tailwind class sorting, and extends Nunio's shared
TypeScript configuration. Stories and tooling are
excluded from the compiled component exports.
