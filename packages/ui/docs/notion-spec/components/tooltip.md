# Tooltip spec

Captured 2026-10-28 from the "nui sandbox page": topbar buttons (Teilen, Link kopieren, Favorit, Aktionen), sidebar header (Seitenleiste schließen, Neue Seite), sidebar footer (Hilfe) and the floating AI button. Base UI: `@base-ui/react/tooltip`.

Notion has two tooltip looks and three open delays. The look follows the trigger's surface (a dark chip for chrome buttons, a light card for the floating button); the delay is set per trigger.

## Variants

| Variant   | Content                      | Surface             | Placement                       | Open delay | Where in Notion                                              |
| --------- | ---------------------------- | ------------------- | ------------------------------- | ---------- | ------------------------------------------------------------ |
| `default` | label                        | dark chip           | below, gap 6, centred; flips up | 180ms      | "Neue Seite", "Seitenleiste schließen", "Hilfe" (flipped up) |
| `default` | label + shortcut line        | dark chip           | below, gap 6, centred           | 180ms      | "Link kopieren / ⌘⌥L", "Favorit"                             |
| `default` | description + shortcut line  | dark chip           | below, gap 6, centred           | **435ms**  | "Teilen": "Nur du hast Zugriff. / ⌘⇧O"; "Aktionen"           |
| `card`    | label + inline shortcut chip | light elevated card | above, gap 8, aligned to end    | **140ms**  | floating AI button: "Über diese Seite chatten ⌘J"            |

Labels ending in "…" ("Neu …", "Hilfe, Kontakt und mehr …") carry the ellipsis in their text; it is not CSS truncation.

## Anatomy

| Base UI part           | Notion element                                                        | Notes                                                       |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Provider`             | app-wide                                                              | no "warm" instant open, see Behaviour                       |
| `Trigger`              | any button (Button spec)                                              |                                                             |
| `Positioner` / `Popup` | `div[role="dialog"]`, `pointer-events: none`, inside a fading wrapper | Notion uses `dialog`; nui keeps Base UI's tooltip semantics |
| `Arrow`                | absent in Notion                                                      |                                                             |
| `Viewport`             | absent in Notion                                                      |                                                             |
| label / shortcut line  | `div` + `span` children                                               | not Base UI parts                                           |
| shortcut chip (`card`) | rounded `span`, the Kbd component                                     | separate spec                                               |

## Parts

### `Popup`, `default`

| Property   | Value                                                                        | Notion source                                                 |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Box        | `rounded-md px-2 py-[5px] max-w-75`                                          | `pad 5 8`, `r 6`, `max-w 300`; one line is 26.8px, two 43.6px |
| Background | `bg-accent`, both themes                                                     | `bacAccPri` (`#2c2c2b`; not overridden in dark)               |
| Shadow     | `0 4px 12px -2px rgb(0 0 0 / 0.08), inset 0 0 0 1px rgb(255 255 255 / 0.05)` | raw values, no Notion token (see Gaps)                        |
| Label      | `text-xs leading-[1.4] text-inverse`                                         | 12/16.8, 400, `texInvPri`                                     |
| Shortcut   | second line, `text-xs text-inverse-secondary`                                | 12px, `texInvSec`                                             |
| Wrapping   | `text-pretty wrap-break-word`                                                | `text-wrap: pretty`, `overflow-wrap: break-word`              |

### `Popup`, `card`

| Property   | Value                                                                                                               | Notion source                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Box        | `rounded-[10px] px-2.5 py-1.5 max-w-75`                                                                             | `pad 6 10`, `r 10`, 33px tall                              |
| Background | `bg-elevated`                                                                                                       | `bacEle` (light `#fff`, dark `#202020`)                    |
| Shadow     | `shadow-md`                                                                                                         | `shaOutMd`, both themes                                    |
| Label      | `text-sm leading-[1.5] text-primary`                                                                                | 14/21, 400, `texPri`                                       |
| Shortcut   | inline chip after the label, `ml-1`: `rounded-sm px-1 text-xs leading-[1.5] font-medium text-tertiary bg-secondary` | 25.8×18, `pad 0 4`, `r 4`, 12/18 500, `texTer` on `bacSec` |

## States

| Part      | State             | Change                                                | Notion source                   |
| --------- | ----------------- | ----------------------------------------------------- | ------------------------------- |
| `Popup`   | `data-open`       | visible after the trigger's delay                     | pointer enter or keyboard focus |
| `Popup`   | pointer           | `pointer-events-none`; the popup never captures hover | `pe=none`                       |
| `Trigger` | `data-popup-open` | no change (Button spec)                               |                                 |

Both variants look the same in dark mode apart from the `card` surface token flipping; the `default` chip is identical in both themes.

## Motion

| Transition | Element         | initial → animate / exit                                   | Duration | Delay                                    | Ease                         |
| ---------- | --------------- | ---------------------------------------------------------- | -------- | ---------------------------------------- | ---------------------------- |
| open       | `default` popup | `{ opacity: 0 }` → `{ opacity: 1 }`                        | 0.05     | trigger's delay (180 / 435ms)            | `ease-out` `[0, 0, 0.58, 1]` |
| close      | `default` popup | exit `{ opacity: 0 }`, unmount at end                      | 0.05     | 0 (removed 55–60ms after pointer leaves) | `[0, 0, 0.58, 1]`            |
| open       | `card` popup    | `{ opacity: 0, scale: 0.96 }` → `{ opacity: 1, scale: 1 }` | 0.05     | 140ms                                    | `[0, 0, 0.58, 1]`            |
| close      | `card` popup    | exit `{ opacity: 0, scale: 0.96 }`                         | 0.05     | 0                                        | `[0, 0, 0.58, 1]`            |

Measured delays (pointer enter → tooltip mounted), each from an idle start: Link kopieren 183 / 184ms, Favorit 183ms, Neue Seite 185ms, Seitenleiste schließen 186ms, Hilfe 184ms, Teilen 435ms, Aktionen 434ms, floating AI 138ms.

Reduced motion: no `prefers-reduced-motion` rules apply.

## Interaction

| Part      | Hit area                      | Cursor    | Focus-visible                                        |
| --------- | ----------------------------- | --------- | ---------------------------------------------------- |
| `Trigger` | Button spec                   | `pointer` | keyboard focus on the trigger also opens the tooltip |
| `Popup`   | none (`pointer-events: none`) |           | not focusable                                        |
- **No warm open:** moving straight from one trigger to its neighbour closes the first tooltip (~55ms) and opens the second after the full 183ms. In Base UI terms: `Tooltip.Provider timeout={0}`, so `data-instant` never applies.
- **No close delay:** `closeDelay={0}`.
- **Not hoverable:** `disableHoverablePopup` on the Root, matching `pointer-events: none`.
- **Placement:** `default` uses `side="bottom" sideOffset={6} align="center"` and flips to the top at the viewport edge ("Hilfe" in the sidebar footer opened above its trigger, still gap 6 and centred). `card` uses `side="top" sideOffset={8} align="end"`.

## Responsive

No `@media` or `@container` rules apply to the tooltip or its wrapper. Placement adapts only through collision flipping.

## Dark mode

`default` is identical in both themes (`bacAccPri`, `texInvPri` and `texInvSec` are not overridden in dark). `card` follows `bacEle` (`#202020` dark) and keeps `shaOutMd`.

## Gaps

- **Untokenized:** the `default` shadow, `0 4px 12px -2px rgb(0 0 0 / 0.08), inset 0 0 0 1px rgb(255 255 255 / 0.05)`. Add it as a `--shadow-tooltip` entry in `SHADOW_DERIVED` in `scripts/build-tokens.ts`.
- **Delay tiers:** Notion sets delays per trigger. nui should default to 180ms and let callers pass 435ms (descriptive tooltips like "Teilen") or 140ms (the floating button); why Notion picks which is not observable.
- **Not observable:**
  - `transform-origin` of the `card` scale (it opened above an end-aligned trigger; likely bottom right).
  - Focus-open delay: the tooltip was open within 800ms of keyboard focus; the exact delay was not timed.
  - Live window resizing (not attempted after the resize problems in earlier sessions); no responsive rules exist to observe.
  - Tooltips wider than 300px, to confirm wrapping at `max-width`.

## Screenshots

`tooltip/<variant>-<content>-<theme>.png`: `default-label-light`, `default-shortcut-{light,dark}`, `default-description-light`, `default-flipped-top-light`, `card-{light,dark}`.
