# Button spec

Captured 2026-10-28 from the topbar and sidebar of the "nui sandbox page", the Share popover (both views), and Settings → account. Base UI: `@base-ui/react/button`.

Notion's buttons are one family: a shared shape (radius 6, 14px type, icon-first) and a single derivation rule for states. Each variant names one **base color token**; hover, focus-visible and pressed are computed from it, so a variant only ever specifies its base color.

## Variants

Sizes: `sm` 24px, `default` 28px, `lg` 32px; icon-only sizes are square.

| Variant       | Size                    | Content                              | Intent              | Where in Notion                                             |
| ------------- | ----------------------- | ------------------------------------ | ------------------- | ----------------------------------------------------------- |
| `ghost`       | `default`               | label, icon + label, label + chevron | neutral             | topbar "Teilen", "Icon hinzufügen", "Vollzugriff ⌄"         |
| `ghost`       | `sm`                    | icon + label + chevron               | neutral             | topbar breadcrumb "Privat ⌄"                                |
| `ghost`       | `icon` 28               | icon only                            | neutral             | topbar "•••", link, favorite; sidebar header icons          |
| `ghost`       | `icon-sm` 24            | icon only                            | neutral             | Share popover back arrow, Settings copy icon                |
| `ghost`       | `icon-xs` 20            | icon only                            | neutral             | sidebar row "+" and "•••", callout ×                        |
| `primary`     | `lg`                    | label                                | blue                | Share popover "Einladen"                                    |
| `primary`     | `default`               | label                                | blue                | Settings "Passkey hinzufügen" (the recommended action)      |
| `secondary`   | `default`               | label                                | neutral filled      | Invite view "Loslegen"                                      |
| `outline`     | `lg`                    | icon + label                         | neutral             | Share popover "Link kopieren"                               |
| `outline`     | `default`               | label                                | neutral             | Settings "Passwort hinzufügen", "E-Mails verwalten"         |
| `outline`     | `default`, quiet        | label, 12px secondary text           | neutral, low weight | Settings devices "Abmelden"                                 |
| `destructive` | `default`               | label                                | red                 | Settings "Mein Konto löschen", "Von allen Geräten abmelden" |
| `pill`        | 32, `rounded-full`      | icon + label                         | neutral filled      | "Erste Schritte mit" row ("Datenbank", "Formular")          |
| `ghost`       | inverse                 | label                                | on dark surface     | onboarding card "Jetzt nicht", "Loslegen"                   |
| `fab`         | 40 × 40, `rounded-full` | icon only                            | elevated            | floating AI button, bottom right                            |

Contextual tone: a `ghost` inside a colored surface takes that color's family. The × in the blue callout uses `text-blue-secondary` and hovers with `bg-blue-interactive-translucent`.

## Anatomy

| Base UI part  | Notion element                                            | Notes                                              |
| ------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `Button`      | `div[role="button"]` with inline `--x-*` state variables  | Notion renders a `div`; nui uses a native `button` |
| icon (child)  | `svg` first child, `fill: currentColor` via icon token    | not a Base UI part; Lucide icon slot               |
| label (child) | text node                                                 | not a Base UI part                                 |
| chevron       | trailing `svg`, 11–14px, `text-icon-tertiary`/`secondary` | not a Base UI part                                 |

## Parts

### `Button`, shared

| Property | Value                                      | Notion source                       |
| -------- | ------------------------------------------ | ----------------------------------- |
| Display  | `inline-flex items-center shrink-0`        | measured layout                     |
| Radius   | `rounded-md` (6px)                         | `r 6` on every variant but pill/fab |
| Font     | `text-sm leading-[1.2]` (14/16.8)          | `font 14/16.8`                      |
| Cursor   | `cursor-pointer`                           | `cursor pointer`                    |
| Wrap     | `whitespace-nowrap`; label never truncates | width stays fixed at 500–1470px     |

### Per variant

| Variant             | Size / padding / gap                          | Weight | Text                                   | Background                     | Border                              | Icon                                                   |
| ------------------- | --------------------------------------------- | ------ | -------------------------------------- | ------------------------------ | ----------------------------------- | ------------------------------------------------------ |
| `ghost` `default`   | `h-7 px-2 gap-1.5`                            | 400    | `text-primary`                         | transparent                    | none                                | `size-4` (see Icons), `text-icon-primary`              |
| `ghost` `sm`        | `h-6 px-1.5 gap-1`                            | 400    | `text-primary`                         | transparent                    | none                                | `size-4` + chevron `size-[11px]`, `text-icon-tertiary` |
| `ghost` `icon`      | `size-7`                                      | –      | –                                      | transparent                    | none                                | `size-5` (`•••` is `size-[22px]`), `text-icon-primary` |
| `ghost` `icon-sm`   | `size-6`                                      | –      | –                                      | transparent                    | none                                | `size-4`–`size-5`, `text-icon-secondary`               |
| `ghost` `icon-xs`   | `size-5 rounded-sm` (4px)                     | –      | `text-secondary`                       | transparent                    | none                                | `size-4`, `text-icon-secondary`                        |
| `primary` `lg`      | `h-8 px-3`                                    | 500    | `text-blue-inverse`                    | `bg-blue-accent`               | none                                | –                                                      |
| `primary` `default` | `h-7 px-2`                                    | 500    | `text-blue-inverse`                    | `bg-blue-accent`               | none                                | –                                                      |
| `secondary`         | `h-7 px-3 py-2`                               | 500    | `text-primary`                         | `bg-tertiary-translucent`      | none                                | –                                                      |
| `outline` `lg`      | `h-8 px-3 gap-2`                              | 500    | `text-primary`                         | transparent                    | `border border-primary-translucent` | `size-4` (see Icons), `text-icon-secondary`            |
| `outline` `default` | `h-7 px-2`                                    | 500    | `text-primary`                         | transparent                    | `border border-primary-translucent` | –                                                      |
| `outline` quiet     | `h-7 px-2 py-1.5`                             | 500    | `text-xs leading-[1.2] text-secondary` | transparent                    | `border border-primary-translucent` | –                                                      |
| `destructive`       | `h-7 px-2`                                    | 500    | `text-red-accent`                      | `bg-red-secondary-translucent` | none                                | –                                                      |
| `pill`              | `h-8 rounded-full py-1.5 pl-2.5 pr-3.5 gap-1` | 500    | `text-primary` (14/20)                 | `bg-tertiary-translucent`      | none                                | `size-5`, `text-icon-primary`                          |
| `ghost` inverse     | `h-[24.8px] px-1.5 py-1`, `text-xs`           | 400    | `text-inverse`                         | transparent                    | none                                | –                                                      |
| `fab`               | `size-10 rounded-full`                        | –      | `text-primary`                         | `bg-assistant-button`          | none, `shadow-md`                   | `size-5`, `text-black` in both themes (see Icons)      |

### Icons

Notion's svg boxes hug their glyph (the "Teilen" lock is 12.1×20, the link icon 14.9×20), while Lucide icons are square on a 24px grid. Text buttons therefore use 16px Lucide icons: they draw the same visual size, and widths land within 1px of Notion for "Link kopieren" (138.1 vs 137.1) and exactly for the pill (119.5). The ghost "Teilen" stays 4px wider (75.8 vs 71.8) because Lucide's lock glyph is wider than Notion's. The pill's table icon is a true 20px square in Notion, so the pill keeps `size-5`.

The `fab` icon in Notion is a fixed-color image, not an svg, so it stays dark on the dark theme's light gray (`#d3d3d3`) background. nui pins Lucide icons in this variant to `text-black`; the image's exact color is baked into a raster and has no token.

The secondary-text chevron variant ("Vollzugriff ⌄") is `ghost` with `text-secondary` and a `size-3.5` `text-icon-secondary` chevron.

## States

Notion derives every state from the variant's base token with CSS relative color syntax. `--btn-adj-mult` is unset in both themes, so its fallbacks apply. Keep these expressions as they are. Every row was measured live in light and dark, except pill's `:active`, which follows the `secondary` family it shares a base token with.

| Variant family           | Base token                 | `:hover`                                | `:focus-visible` (bg) | `:active`                                           |
| ------------------------ | -------------------------- | --------------------------------------- | --------------------- | --------------------------------------------------- |
| `ghost` (all sizes)      | `bacIntTra`                | base × 1 alpha                          | base × 1 alpha        | base × 2 alpha                                      |
| `outline` (all sizes)    | `bacIntTra`                | base × 1 alpha                          | base × 1 alpha        | base × 1.5 alpha                                    |
| `secondary`, `pill`      | `bacTerTra` (also idle)    | base × 1.5 alpha                        | base × 1.5 alpha      | base × 2 alpha                                      |
| `destructive`            | `redBacSecTra` (also idle) | base × 1.5 alpha                        | base × 1.5 alpha      | base × 2 alpha                                      |
| `primary`                | `bluBacAccPri` (also idle) | HSL lightness − 5                       | HSL lightness − 5     | HSL lightness − 10                                  |
| tinted ghost (callout ×) | `bluBacIntTra`             | base × 1 alpha                          | base × 1 alpha        | base × 2 alpha                                      |
| `fab`                    | `assCorButBac`             | `bg-assistant-button-hover` + scale 1.1 | –                     | `bg-assistant-button-pressed` (token, not observed) |

Notion's source, verbatim:

- alpha: `rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 0) * 1)))` for hover; `… var(--btn-adj-mult, 1) * 2` for active.
- primary: `hsl(from bluBacAccPri h s calc(l - var(--btn-adj-mult, 1) * 5) / alpha)`; active uses `* 10`.

Measured values:

- ghost hover: `#211b17` at 5% (light), `#ffffff` at 5.5% (dark), exactly `bacIntTra` per theme.
- secondary and pill hover: `bacTerTra×1.5`; destructive hover `redBacSecTra×1.5`, both themes.
- primary hover: `#1f76cc` in both themes (`bluBacAccPri` is not overridden in dark).

| State            | Change                                                                         | Notion source                                     |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `:focus-visible` | the state background above **plus** `shadow-focus-button` ring; `outline-none` | `butBluFocRin`, set by JS on focus; both themes   |
| `data-disabled`  | `opacity-40 cursor-default`; hovering changes nothing                          | `op 0.4`, `cursor default`, no `--x-*` hover vars |
| hover-revealed   | `opacity-0` until the parent is hovered, then `opacity-100`                    | "Icon hinzufügen": `op 0`, `tr opacity 0.1s ease` |

## Motion

Button backgrounds are CSS transitions; only the `fab` scale is worth Motion.

| Transition          | Element                                                                             | From → to                         | Duration | Delay | Ease                                |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------------------- | -------- | ----- | ----------------------------------- |
| hover in/out, press | `ghost` (text), `primary`, `secondary`, `destructive`, `pill`, `icon-sm`, `icon-xs` | background                        | 0.1      | 0     | `ease-in-out` `[0.42, 0, 0.58, 1]`  |
| hover in/out, press | `outline`, `ghost` `icon` (28px), `ghost` inverse                                   | background                        | 0.02     | 0     | `ease-in` `[0.42, 0, 1, 1]`         |
| reveal              | hover-revealed buttons                                                              | opacity 0 → 1                     | 0.1      | 0     | `ease` `[0.25, 0.1, 0.25, 1]`       |
| hover in/out        | `fab`                                                                               | `{ scale: 1 }` → `{ scale: 1.1 }` | 0.25     | 0     | `[0.34, 1.56, 0.64, 1]` (overshoot) |

As Tailwind: `transition-[background-color] duration-100 ease-in-out` and `duration-[20ms] ease-in`. The fab, in Motion terms: `whileHover={{ scale: 1.1 }} transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}`.

Buttons with a tooltip show it 440ms after hover begins (145ms when a tooltip was just visible), fading `opacity` 0 → 1 over 50ms `ease-out`, scale 0.96 → 1 for the fab's tooltip. That belongs to the Tooltip spec.

Reduced motion: Notion has no `prefers-reduced-motion` rules for buttons.

## Interaction

| Part          | Hit area                                                      | Cursor    | Focus-visible                            |
| ------------- | ------------------------------------------------------------- | --------- | ---------------------------------------- |
| every variant | equal to the box (28×28, 72×28, 80×32, 24×24, 20×20 measured) | `pointer` | `shadow-focus-button` + state background |
| disabled      | equal to the box                                              | `default` | n/a                                      |

No variant extends its hit area beyond its visual box, so 20px `icon-xs` buttons are 20px targets. The topbar's buttons sit edge to edge with no gap, so each one's hit area ends where its neighbour's begins.

Focus: `:focus` has `outline: 0`; `forced-colors: active` restores a 2px transparent outline with 2px offset, which forced-colors mode paints. Keep that for accessibility.

## Responsive

| Width (px) | Change                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| 1470       | baseline                                                                                        |
| 1024       | no change to buttons; the topbar drops "Bearbeitet vor …", the chip row folds into its "•••"    |
| 768        | no change to buttons                                                                            |
| 600        | no change to buttons; breadcrumb title truncates (126 → 49px)                                   |
| 500        | no change to buttons; breadcrumb title truncates to 12px (Chrome's minimum window width is 500) |

Buttons are fixed-size `shrink-0` elements at every width; their containers absorb the space. Touch: no `(pointer: coarse)` rules apply to buttons.

## Dark mode

Tokens cover everything, with one Notion quirk: the dark theme overrides only `assCorButBac` (`#d3d3d3`), not its hover and pressed tokens, so the dark `fab` hovers to the light theme's `#efefee`. nui reproduces this automatically because `tokens.css` inherits non-overridden values the same way.

## Gaps

- **Untokenized:** none. Primary's hover (`#1f76cc`) is reported as untokenized by the probe because it is an HSL derivation, not a token at another alpha.
- **Derived tokens:** `scripts/build-tokens.ts` generates the derived states as utilities: alpha multiples get a percentage suffix (`bg-interactive-translucent-200` is `bacIntTra` at 2× alpha, `-150` at 1.5×), primary's HSL offsets are `bg-blue-accent-hover` and `bg-blue-accent-pressed`.
- **Not observable:**
  - `ghost` inverse screenshots: the onboarding card was dismissed after the first visit and did not return; its measurements are from that visit.
  - `:active` screenshots: the browser tools cannot hold the mouse button; pressed values come from the stylesheet rules above.
  - Disabled exists only on an `outline` button in Notion's UI.
  - `fab` pressed (`assCorButBacPre`) is known from the token, not observed.
  - Phone layouts, which Notion serves based on user agent rather than width.

## Screenshots

`button/<variant>-<state>-<theme>.png`, idle and hover for every variant in light and dark, plus focus for `primary` (`primary-focus-*` is `lg`, `primary-md-focus-*` is `default`). Variant prefixes: `ghost`, `ghost-chevron`, `ghost-tinted`, `sm`, `icon`, `icon-sm`, `icon-xs` (hover only; it is hidden at idle), `primary`, `secondary`, `outline` (`lg`), `outline-md`, `outline-sm` (quiet), `destructive`, `disabled`, `pill`, `fab`.
