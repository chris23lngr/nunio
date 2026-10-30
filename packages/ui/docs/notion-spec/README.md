# Notion spec

Values extracted from app.notion.com, the source of truth for nui's look.

## Tokens

`raw-tokens.txt` holds Notion's CSS custom properties as found in its stylesheets (`:root, .notion-light-theme` and `.notion-dark-theme`). `bun run tokens` turns it into `src/styles/tokens.css`:

- every raw value becomes a runtime variable `--n-<notionName>`, with `.dark` overriding only what Notion's dark theme overrides
- a curated subset is mapped into Tailwind's theme (`@theme inline`), and Tailwind's default colors and shadows are removed

### Utility names

Notion's semantic names are `<color?><Role><Level><Tra?>`, e.g. `bluBacTerTra`.

| Notion role      | Utility       | Example                                                  |
| ---------------- | ------------- | -------------------------------------------------------- |
| `Tex` text       | `text-*`      | `text-secondary`, `text-blue-secondary`                  |
| `Ico` icon       | `text-icon-*` | `text-icon-tertiary` (Lucide strokes use `currentColor`) |
| `Bac` background | `bg-*`        | `bg-secondary`, `bg-red-tertiary`                        |
| `Bor` border     | `border-*`    | `border-primary`, `border-strong`                        |

Levels: `Pri` primary, `Sec` secondary, `Ter` tertiary, `Dis` disabled, `Str` strong, `Int` interactive, `Ele` elevated, `AccPri` accent, `AccSec` accent-secondary, `InvPri` inverse, `InvSec` inverse-secondary. A `Tra` suffix becomes `-translucent`.

Colors: gray, brown, orange, yellow, green, blue, purple, pink, red, teal. Raw palettes are `bg-blue-500`, `bg-gray-alpha-300`, `bg-ui-blue-600`.

Interaction states and surfaces: `bg-hover`, `bg-pressed`, `bg-button-hover`, `bg-popover`, `bg-overlay`, … Shadows: `shadow-sm|md|lg|diffuse|screen` (with a 1px outline ring), `shadow-base-*` (without), `shadow-button`, `shadow-focus`, `shadow-focus-input`.

See `scripts/build-tokens.ts` for the full mapping.

## Typography

Font stack (Notion's): `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, …`. Page body 16px/24px, H1 40px/48px bold, H2 24px/31.2px semibold. Sidebar rows are 30px tall with a 6px radius.

## Known deviations from WCAG

Notion's `texSec` (#7d7a75) on white is 4.27:1, below AA for small text. We keep it for fidelity; the axe `color-contrast` rule is disabled in Storybook.

## Still to extract

Per-component measurements (heights, paddings, radii, which shadow each surface uses, transitions) need live components to inspect.
