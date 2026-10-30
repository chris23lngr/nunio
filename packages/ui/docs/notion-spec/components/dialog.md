# Dialog spec

Captured 2026-10-28 from Notion's Settings modal (workspace switcher → "Einstellungen"). Base UI: `@base-ui/react/dialog`.

Notion's dialog is a centered surface over a dimmed backdrop. Backdrop and popup share one fixed, full-viewport wrapper that fades; the popup additionally scales up from 0.97. Sizing is set per surface, like popovers.

## Variants

| Variant    | Content                                        | Size                                         | Where in Notion |
| ---------- | ---------------------------------------------- | -------------------------------------------- | --------------- |
| `settings` | sidebar navigation + scrolling page, close "×" | `90vw` × `calc(100% - 100px)`, max 1512 wide | Settings modal  |

Confirmation dialogs ("Delete property") are AlertDialog and get their own spec.

## Anatomy

| Base UI part  | Notion element                                        | Notes                                               |
| ------------- | ----------------------------------------------------- | --------------------------------------------------- |
| `Trigger`     | "Einstellungen" menu item                             | menu closes first, then the dialog opens            |
| `Portal`      | fixed `div`, 100vw × 100vh, `display: flex`, centered | fades opacity 0 → 1; holds backdrop and popup       |
| `Backdrop`    | `div`, `position: absolute; inset: 0`, `modUndBac`    | click closes                                        |
| `Viewport`    | the same flex wrapper                                 | centers the popup                                   |
| `Popup`       | `div[role=dialog]` 1323×593 at a 1470×693 viewport    | `overflow: hidden`, `z-index: 1` above the backdrop |
| `Close`       | 22×22 round "×" button, `aria-label="Schließen"`      | 12px from the popup's top and right edges           |
| `Title`       | not exposed as the dialog's label                     | the page heading is content                         |
| `Description` | absent                                                |                                                     |

## Parts

### `Popup`

| Property   | Value                                                                    | Notion source                           |
| ---------- | ------------------------------------------------------------------------ | --------------------------------------- |
| Size       | set per surface; settings `w-[90vw] max-w-[1512px] h-[calc(100%-100px)]` | inline `width`, `max-width`, `height`   |
| Max height | `max-h-full` of the viewport wrapper                                     | `max-height: 100%`                      |
| Radius     | `rounded-xl` (12)                                                        | `r 12`                                  |
| Background | `bg-elevated`                                                            | `bacEle` (light `#fff`, dark `#202020`) |
| Shadow     | `shadow-screen`                                                          | `shaOutScr`, both themes                |
| Overflow   | `overflow-hidden`                                                        | content scrolls inside                  |
| Padding    | none                                                                     | `pad 0`                                 |

### `Backdrop`

| Property   | Value           | Notion source                                                |
| ---------- | --------------- | ------------------------------------------------------------ |
| Background | `bg-overlay`    | `modUndBac`: light `#0f0f0f99` (60%), dark `#0f0f0fcc` (80%) |
| Extent     | `fixed inset-0` | full viewport                                                |

### `Close`

| Property | Value                                                     | Notion source                 |
| -------- | --------------------------------------------------------- | ----------------------------- |
| Size     | `size-[22px] rounded-full`                                | 22×22, `r 100%`               |
| Position | `absolute top-3 right-3`                                  | 12px insets                   |
| Icon     | `size-3.5 text-icon-secondary` (14px box)                 | svg 14×14, `icoSec`           |
| Base     | ghost Button: hover `bacIntTra`, active `bacIntTra` at 2× | `rules()` `:hover`, `:active` |
| Cursor   | `pointer`                                                 |                               |

## States

| Part    | State     | Change                           | Notion source                                                                      |
| ------- | --------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `Close` | `:hover`  | `bg-interactive-translucent`     | `rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 0) * 1)))` |
| `Close` | `:active` | `bg-interactive-translucent-200` | `rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 2)))` |

## Motion

| Transition | Element                        | initial → animate / exit                 | Duration | Delay | Ease                   | Origin |
| ---------- | ------------------------------ | ---------------------------------------- | -------- | ----- | ---------------------- | ------ |
| open       | wrapper (`Backdrop` + `Popup`) | `{ opacity: 0 }` → `{ opacity: 1 }`      | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` |        |
| open       | `Popup`                        | `{ scale: 0.97 }` → `{ scale: 1 }`       | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` | center |
| close      | wrapper                        | exit `{ opacity: 0 }`, removed at ~205ms | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` |        |
| close      | `Popup`                        | exit `{ scale: 0.97 }`                   | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` | center |

The opening menu fades out first (200ms), and the dialog starts ~330ms after the click. Reduced motion: no rules (transitions are inline).

## Interaction

| Part       | Hit area           | Cursor    | Focus-visible    |
| ---------- | ------------------ | --------- | ---------------- |
| `Close`    | 22×22, same as box | `pointer` | Button spec ring |
| `Backdrop` | full viewport      | `auto`    | none             |

Focus: on open, the first field ("Einstellungen durchsuchen") is focused, Base UI's default. Escape and a backdrop click close. On close, focus returned to `body` here because the trigger was a menu item that no longer exists; Base UI returns it to the trigger when there is one. While open, `html` and `body` are `overflow: hidden` (scroll lock).

## Responsive

| Width | Change                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| 1470  | baseline: 1323×593 popup (90vw, viewport height − 100px)                                                   |
| all   | no `@media` or `@container` rules on any dialog part; sizing is viewport-relative (`90vw`, `100% - 100px`) |

Touch: `(pointer: coarse)` rules: none.

## Dark mode

None beyond tokens: `bacEle`, `modUndBac` (darker in dark) and `shaOutScr` (gains a 1px `#383836` ring) flip with the theme.

## Gaps

- **Not observable:** other window widths were not screenshotted; resizing the browser window proved unreliable during the Popover spec. Notion's sizing is viewport-relative with no media queries, so no layout change is expected.
- **Close icon:** Notion's 14px "×" glyph is matched with Lucide `X` by eye; not measured against a zoomed capture.
- **Unmapped tokens:** none.

## Screenshots

`dialog/settings-open-{light,dark}.png` (close button hovered).
