# Dropdown Menu spec

Captured 2026-10-28 from the "nui sandbox page": the topbar "•••" page menu and its "Darstellung und Layout" submenu, the sidebar row "•••" menu, and the workspace switcher. Base UI: `@base-ui/react/menu`.

Notion's menus share one surface and one row; they differ in what surrounds the rows. The page menu is a **filterable** menu: focus stays in a search input while arrow keys move a virtual highlight (`aria-activedescendant`), which is Base UI's `Menu.Input` + `Menu.List`.

## Variants

| Variant      | Content                                                                                  | Width | Placement                               | Where in Notion                       |
| ------------ | ---------------------------------------------------------------------------------------- | ----- | --------------------------------------- | ------------------------------------- |
| `searchable` | search input, icon rows with shortcuts, submenu rows, trailing value, switch row, footer | 256   | below trigger, gap 8, align end         | topbar "•••" page menu                |
| `pointer`    | group label, icon rows with shortcuts, footer                                            | 265   | at the click point, clamped to viewport | sidebar row "•••"                     |
| `switcher`   | header label with an inline icon button, avatar rows with a trailing check, accent rows  | 300   | above trigger, gap 4, align start       | workspace switcher (sidebar bottom)   |
| `submenu`    | group labels, radio tiles, switch rows, nested submenu row                               | 300   | inline side, flips left; gap 0; centred | "Darstellung und Layout" in page menu |

Row content seen across them: icon + label, icon + label + shortcut, icon + label + chevron (submenu), icon + truncated label + trailing value + chevron, icon + label + switch, avatar + label + tag, avatar + label + check, accent (blue) icon + label.

## Anatomy

| Base UI part                     | Notion element                                                                | Notes                                              |
| -------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| `Trigger`                        | `•••` ghost icon button, sidebar row button, workspace button                 | Button spec; keeps its hover background while open |
| `Positioner` / `Popup`           | shadowed `div`, 256×≤599                                                      | the visible surface                                |
| `Input`                          | `input[role=combobox]` in a 232×28 wrapper                                    | `searchable` only; focused on open                 |
| `List`                           | `div[role=listbox]` (`searchable`), `div[role=menu]` (others)                 |                                                    |
| `Group`                          | 4px-padded wrapper around a run of rows                                       |                                                    |
| `GroupLabel`                     | 12px medium text ("Seite", "Schriftstil", account email)                      |                                                    |
| `Item`                           | `div[role=option]` / `div[role=menuitem]`, 248×28                             |                                                    |
| `Separator`                      | 232×1 line between groups                                                     |                                                    |
| `SubmenuRoot` / `SubmenuTrigger` | row with trailing chevron, `aria-expanded`                                    |                                                    |
| `RadioGroup` / `RadioItem`       | font tiles (Standard / Serife / Mono); workspace rows with ✓                  | two visual forms, see Parts                        |
| `RadioItemIndicator`             | blue ring + tint on the tile; trailing ✓ on workspace rows                    |                                                    |
| `CheckboxItem`                   | rows with a 30×18 switch ("Kleiner Text", "Seite sperren")                    | indicator is the Switch component (separate spec)  |
| `Empty`                          | not observed (no filter typed; typing would be harmless but was out of scope) |                                                    |
| `Arrow`, `Backdrop`, `Viewport`  | absent in Notion                                                              |                                                    |
| footer                           | "Zuletzt bearbeitet / name / date" block                                      | not a Base UI part; plain content below the list   |

## Parts

### `Popup`

| Property   | Value                                                                                   | Notion source                           |
| ---------- | --------------------------------------------------------------------------------------- | --------------------------------------- |
| Width      | `w-64` (256) `searchable`; `w-[265px]` `pointer`; `w-75` (300) `switcher` and `submenu` | measured                                |
| Max height | `max-h-[80vh]`, `overflow-hidden` (list scrolls inside)                                 | 599.2px at a 749px viewport             |
| Radius     | `rounded-[10px]`                                                                        | `r 10`                                  |
| Background | `bg-popover`                                                                            | `popBac` (light `#fff`, dark `#252525`) |
| Shadow     | `shadow-lg`                                                                             | `shaOutLg`, both themes                 |

### `Input` (searchable)

| Property  | Value                                                                    | Notion source                                     |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| Wrapper   | `mx-3 mt-3 mb-2 h-7 rounded-md px-1.5 py-[3px] bg-secondary-translucent` | 232×28, 12px from popup edges, 8px above the list |
| Idle ring | 1px `borPriTra` ring (`0 0 0 1px`)                                       | measured in dark (`vars box-shadow←borPriTra`)    |
| Focused   | `shadow-focus-input`                                                     | `inpBluFocRin`                                    |
| Text      | `text-sm leading-5 text-primary` (14/20)                                 |                                                   |

### `Group`, `Separator`, `GroupLabel`

| Part         | Value                                                                                                          | Notion source                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `Group`      | `flex flex-col gap-px p-1`                                                                                     | `pad 4`, `gap 1`; `switcher` rows have no gap  |
| `Separator`  | `mx-3 h-px bg-tertiary-translucent`                                                                            | 232×1, `bacTerTra` (same value as `borSecTra`) |
| `GroupLabel` | `px-2 text-xs leading-[1.2] font-medium text-secondary`, 10px from the group's top edge, 10px to the first row | 12/14.4, 500, `texSec`                         |

Groups are padded 4px and the separator sits between them, so a separator reads as 4px + 1px + 4px between rows.

### `Item`

| Property       | Value                                                                   | Notion source             |
| -------------- | ----------------------------------------------------------------------- | ------------------------- |
| Size           | `h-7` (28), full width minus the group's 4px inset (248 in a 256 popup) | measured                  |
| Layout         | `flex items-center gap-2 px-2 rounded-md`                               | `pad 0 8`, `gap 8`, `r 6` |
| Font           | `text-sm leading-[1.2] text-primary`                                    | 14/16.8, 400, `texPri`    |
| Icon           | `size-5 text-icon-primary`                                              | 20×20, `icoPri`           |
| Label          | `flex-1 truncate`                                                       | truncates ("Benachrich…") |
| Shortcut       | `text-xs text-tertiary`, right aligned                                  | 12px, `texTer` ("⌘⌥L")    |
| Trailing value | `text-sm text-tertiary`                                                 | "Kommentare", `texTer`    |
| Chevron        | `size-4 text-icon-secondary`                                            | 16×16, `icoSec`           |
| Cursor         | `cursor-pointer`                                                        |                           |

`switcher` rows differ: `h-7 px-1.5 gap-1.5` (inner `pad 0 6`, `gap 6`), contiguous with no 1px gap, the trailing ✓ is `size-5 text-primary`, avatar letters are 13.75px `text-secondary` in a 20px box.

Accent rows ("Neuer Workspace", "Upgrade durchführen"): label `text-sm leading-5 text-blue-accent`, icon `size-4 text-blue-accent` (`bluTexAccPri`).

### `RadioItem` as tile (submenu)

| Property | Value                                                             | Notion source                                            |
| -------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| Size     | `w-[92px] h-[61px] rounded-sm pt-2.5 px-1.5 pb-1.5`               | 92×61, `r 4`, `pad 10 6 6`                               |
| Glyph    | "Ag" `text-2xl leading-none`                                      | 24/24                                                    |
| Caption  | `text-xs leading-4 text-secondary`                                | 12/16, `texSec`                                          |
| Checked  | `bg-interactive-translucent shadow-focus-button text-blue-accent` | `bacIntTra`, `butBluFocRin`, `bluTexAccPri`, both themes |

### Footer

`px-3 py-2 flex flex-col gap-0.5`; first line `text-xs font-medium text-tertiary` (12/16, 500), following lines `text-xs text-tertiary` (12/16, 400). Separated from the list by a `Separator`.

## States

| Part               | State                             | Change                                                      | Notion source                        |
| ------------------ | --------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| `Item`             | pointer hover                     | `bg-interactive-translucent`                                | `:hover`, `bacIntTra`, both themes   |
| `Item`             | keyboard highlight                | `bg-interactive-translucent` **plus** `shadow-focus-button` | inline `background` + `butBluFocRin` |
| `Item`             | `:active`                         | `bg-interactive-translucent-200`                            | `bacIntTra` × 2 alpha                |
| `SubmenuTrigger`   | `data-popup-open`                 | keeps `bg-interactive-translucent`                          | measured while submenu open          |
| `Trigger`          | `data-popup-open`                 | keeps its hover background                                  | `bacIntTra`, `aria-expanded=true`    |
| `RadioItem` (tile) | `data-checked`                    | see tile table                                              |                                      |
| `CheckboxItem`     | `data-checked` / `data-unchecked` | switch on / off                                             | fixtures already on and off          |

**Pointer hover and keyboard highlight are independent in Notion.** The keyboard-highlighted row keeps its background and ring while the mouse hovers another row, which shows only a background. Base UI has one `data-highlighted` that follows both. To match: `hover:bg-interactive-translucent` for the pointer, and `data-highlighted:bg-interactive-translucent` plus the ring only when the highlight came from the keyboard (see Gaps).

## Motion

| Transition   | Element                     | initial → animate / exit                                   | Duration | Delay              | Ease                          | Origin                                                        |
| ------------ | --------------------------- | ---------------------------------------------------------- | -------- | ------------------ | ----------------------------- | ------------------------------------------------------------- |
| open         | `Popup` (trigger-anchored)  | `{ opacity: 0, scale: 0.96 }` → `{ opacity: 1, scale: 1 }` | 0.2      | 0                  | `[0.25, 0.1, 0.25, 1]`        | `--transform-origin` (e.g. `100% top` when end-aligned below) |
| close        | `Popup` (trigger-anchored)  | exit `{ opacity: 0, scale: 0.96 }`, unmount at end         | 0.2      | 0                  | `[0.25, 0.1, 0.25, 1]`        | `--transform-origin`                                          |
| open / close | `Popup` (`pointer` variant) | `{ opacity: 0 }` ↔ `{ opacity: 1 }`, no scale              | 0.2      | 0                  | `[0.25, 0.1, 0.25, 1]`        |                                                               |
| open / close | submenu `Popup`             | `{ opacity: 0 }` ↔ `{ opacity: 1 }`, no scale              | 0.2      | ≈170ms hover delay | `[0.25, 0.1, 0.25, 1]`        |                                                               |
| highlight    | `Item`                      | background                                                 | 0.02     | 0                  | `ease-in` `[0.42, 0, 1, 1]`   |                                                               |
| highlight    | `switcher` workspace rows   | background                                                 | 0.15     | 0                  | `ease` `[0.25, 0.1, 0.25, 1]` |                                                               |
| check        | `RadioItem` tile            | color, border                                              | 0.3      | 0                  | `ease`                        |                                                               |

Loading content shows a spinner rotating 0 → 360° every 1.2s, linear (Spinner spec). After close, the trigger's tooltip fades in over 50ms `ease-out` because focus returns to it.

Reduced motion: no `prefers-reduced-motion` rules apply to menus.

## Interaction

| Part      | Hit area                      | Cursor    | Focus-visible                               |
| --------- | ----------------------------- | --------- | ------------------------------------------- |
| `Item`    | equal to the row box (248×28) | `pointer` | `shadow-focus-button` on keyboard highlight |
| `Input`   | wrapper 232×28                | `text`    | `shadow-focus-input`                        |
| `Trigger` | Button spec                   | `pointer` | `shadow-focus-button`                       |
- **Focus on open:** `searchable` focuses the input; the first ArrowDown highlights the first row via `aria-activedescendant`.
- **Focus on close:** returns to the trigger with its focus-visible ring.
- **Escape:** closes the innermost surface first (submenu, then root).
- **Submenu:** opens on hover after ≈170ms, on the inline-end side, flipping to the left when there is no room; its edge sits flush on the trigger row (gap 0, overlapping the parent popup's 4px padding) and it is vertically centred on the trigger row (±130px).
- **Placement:** root `side="bottom" sideOffset={8} align="end"` with a 12px collision padding (the popup stopped 2px short of the trigger's end to stay 12px inside the viewport); `switcher` `side="top" sideOffset={4} align="start"`; `pointer` is anchored to the click coordinates and pushed inside the viewport with the same 12px padding.

## Responsive

No `@media` or `@container` rules apply to the menu surface, list or rows. The only viewport-dependent value is `max-height: 80vh`. Live resizing was not possible this session (see Gaps).

## Dark mode

Tokens cover everything: the surface becomes `popBac` dark (`#252525`), rows and the separator follow `bacIntTra` / `bacTerTra`, and the checked tile keeps its blue ring and text.

## Gaps

- **Untokenized:** none.
- **Derived tokens:** the input's idle ring is `shadow-input` (`0 0 0 1px borPriTra`), generated in `scripts/build-tokens.ts`.
- **Keyboard-only ring (implemented):** the popup records the last input modality in `data-nav`, and rows show `shadow-focus-button` only under `in-data-[nav=keyboard]`. Base UI keeps a single highlight that follows the pointer, so Notion's simultaneous keyboard and pointer highlights cannot both show.
- **Assumed, not measured:** the empty state (`px-3 py-1.5 text-sm text-secondary`), disabled rows (`opacity-40`, as Button), and the search icon (`size-4 text-icon-tertiary`).
- **Not observable:**
  - Live window resizing: `resize_window` reported success but the window stayed 1470×749 (likely maximized); responsive rules were read from stylesheets instead.
  - Search-input placeholder and icon colors, the `Empty` state and filtering behaviour (would need typing into the menu input).
  - Disabled items: none present in these menus.
  - `:active` screenshots (tools cannot hold the mouse button).

## Screenshots

`dropdown-menu/<variant>-<state>-<theme>.png`: `page-menu-idle-light`, `page-menu-keyboard-highlight-light`, `page-menu-keyboard-and-hover-{light,dark}`, `submenu-open-{light,dark}`, `sidebar-menu-idle-{light,dark}`, `workspace-menu-hover-{light,dark}`.
