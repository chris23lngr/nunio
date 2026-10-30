# Command spec

Captured 2026-10-29 from Notion's ⌘K search dialog on the nui sandbox page (1470×715 viewport). Anatomy: [cmdk](https://github.com/pacocoursey/cmdk) 1.1.1, as composed by shadcn's `Command`.

Notion's ⌘K is a frosted, top-anchored dialog: a borderless 16/24 search input, a row of filter chips, grouped result rows on the left and a page preview on the right, and a hint footer. Opening and closing snap. The selected row is a translucent fill, and it gains the blue button focus ring once the keyboard has moved the selection. Pointer hover is a separate highlight that does not move the selection. The query typed while capturing was `sandbox`, then `sandboxqxzvw` for the empty state; it was cleared without pressing Enter.

Implemented in `src/components/ui/command.tsx` on cmdk, following shadcn's parts plus `CommandFooter` for the hint bar. `CommandDialog` wraps Base UI Dialog rather than cmdk's Radix dialog, with no animation, a transparent backdrop and the measured size; `max-w-[calc(100vw-2rem)]` is an addition, since narrow viewports were not observed. `Command` defaults `disablePointerSelection` to true and records arrow-key navigation as `data-nav="keyboard"`, which the selected item reads for its ring. Filter chips and the preview stay with the caller.

## Variants

| Variant            | Content                                                | Size                       | Where in Notion                               |
| ------------------ | ------------------------------------------------------ | -------------------------- | --------------------------------------------- |
| item `default`     | page icon (20px box) + label                           | 572×36                     | "Gestern" recent page ("Pilotkunden Akquise") |
| item `emoji`       | emoji icon + label                                     | 572×36                     | "Beginne mit einer Vorlage" template rows     |
| item `description` | icon + title with match + badge, second line with meta | 572×54.8                   | search results for `sandbox`                  |
| layout `preview`   | list 600 + preview `aside` 406                         | popup 1006×634.6           | a page row is selected                        |
| layout `list`      | list only, the `aside` is removed                      | popup 1006×634.6, list 978 | a template row is selected                    |
| `empty`            | title, description, link                               | centred in the body        | query with no results                         |

The filter chips, the preview `aside` and the footer buttons are Notion features around the command menu, not cmdk parts. They are recorded under Parts so the surface can be rebuilt, but nui's `Command` only needs the hint footer.

## Anatomy

| cmdk part (shadcn)                          | Notion element                                                                                    | Notes                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Command.Dialog` overlay (`[cmdk-overlay]`) | `div.notion-modal-underlay[role=presentation]`, fixed, full viewport                              | transparent; the page stays visible and undimmed                   |
| `Command.Dialog` content (`[cmdk-dialog]`)  | fixed 100vw×100vh flex wrapper (`align-items: start; justify-content: center`)                    | fades as one unit (snap)                                           |
| `Command` root (`[cmdk-root]`)              | `div.notion-dialog[role=dialog]` 1006×634.6                                                       | frosted surface                                                    |
| `Command.Input` (`CommandInput`)            | `input[role=combobox]` 866×24 in a 928×48 row with a leading search icon                          | `aria-activedescendant` points at the selected option              |
| `Command.List` (`[cmdk-list]`)              | `div[role=listbox]` 600 wide (978 without preview), `padding: 0 10px`                             | grows with content; the parent column scrolls                      |
| `Command.Group` (`[cmdk-group]`)            | `div` with `padding: 4px; gap: 1px`                                                               | one per section                                                    |
| `[cmdk-group-heading]`                      | first child of the group, 15px tall                                                               | "Gestern", "Suchergebnisse (1)"; may carry a trailing sort control |
| `Command.Item` (`[cmdk-item]`)              | `div[role=option]` or `a[role=option]`                                                            | selection by `aria-activedescendant`, no data attribute            |
| `Command.Separator`                         | absent; groups are separated by padding and heading margins                                       | the footer's top border is the only rule                           |
| `Command.Empty` (`[cmdk-empty]`)            | centred "Keine Ergebnisse" block                                                                  |                                                                    |
| `Command.Loading` (`[cmdk-loading]`)        | `div[role=status]` spinner (`spin` 1200ms linear); `div[role=progressbar]` shimmer in the preview | shown while results load                                           |
| `CommandShortcut`                           | footer hint "⌘ ↵ In neuem Tab öffnen"                                                             | Notion puts the shortcut in the footer, not on rows                |

## Parts

### Dialog surface (`Command` root inside `Command.Dialog`)

| Property   | Value                                                                                  | Notion source                                 |
| ---------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| Placement  | horizontally centred, `top-[9vh]`                                                      | inline `top: 9vh`; x 232 = (1470 − 1006) / 2  |
| Size       | `w-[1006px] h-[calc(91vh-16px)]` (634.65 at a 715 viewport), `max-h-full`              | inline `width`/`height` set by script         |
| Radius     | `rounded-[20px]`                                                                       | `r 20`                                        |
| Background | `bg-[var(--n-popWaxPapBac)] backdrop-blur-[40px]`: light `#ffffffe6`, dark `#202020e6` | `popWaxPapBac`, `backdrop-filter: blur(40px)` |
| Shadow     | `shadow-screen`                                                                        | `shaOutScr`                                   |
| Overflow   | `overflow-hidden`                                                                      |                                               |
| Type       | `text-base` 16/24, `text-primary`                                                      | `texPri`                                      |

### Overlay

| Property   | Value            | Notion source                   |
| ---------- | ---------------- | ------------------------------- |
| Background | `bg-transparent` | both themes; no `modUndBac` dim |
| Extent     | `fixed inset-0`  | 1470×715                        |

### `Command.Input` row

| Property         | Value                                                                                                  | Notion source                     |
| ---------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Row              | `h-12` (48), `px-3`                                                                                    | row 928×48, child 904 at +12      |
| Search icon      | `size-[22px] text-icon-secondary`, 16px from the popup's left edge, vertically centred                 | svg 22×22 `icoSec`                |
| Input            | starts 50px from the popup's left edge (12px after the icon), `h-6` (24)                               | 866×24                            |
| Input type       | `text-base leading-6 font-normal text-primary`, `bg-transparent`, no border or ring                    | `texPri`                          |
| Placeholder      | `placeholder:text-primary placeholder:opacity-[0.375]`                                                 | both themes, as in the Input spec |
| Cursor           | `cursor-text`                                                                                          |                                   |
| Trailing actions | two `size-8 rounded-full` buttons, 4px apart, 10px from the right edge; `text-blue-accent`, icons 22px | `bluTexAccPri`, `bluIcoAccPri`    |

### Filter chips (Notion only)

| Property   | Value                                                                     | Notion source               |
| ---------- | ------------------------------------------------------------------------- | --------------------------- |
| Row        | 44 tall, chips 6px apart, 12px from the popup's left edge, top at +58     | measured positions          |
| Chip       | `h-6 px-2 gap-1.5 rounded-full text-sm leading-6 text-secondary`          | `r 32`, `pad 0 8`, `texSec` |
| Chip icon  | 16.6×20 glyph, `text-icon-secondary`                                      |                             |
| "+ Filter" | `h-6 pl-[5px] pr-[9px] rounded-xl text-sm leading-[16.8px] text-tertiary` | `r 12`, `texTer`            |

### `Command.List`

| Property | Value                                                      | Notion source                        |
| -------- | ---------------------------------------------------------- | ------------------------------------ |
| Width    | `w-[600px]` beside the preview, full body width without it | inline `width: 600px`; 978 list-only |
| Padding  | `px-2.5`                                                   | `pad 0 10`                           |
| Top      | 92px below the popup's top edge                            | list y 156.3, popup y 64.3           |
| Height   | content height; the 501px body column holds it             | no `max-height` on the list          |

### `Command.Group` and heading

| Property      | Value                                                                  | Notion source                    |
| ------------- | ---------------------------------------------------------------------- | -------------------------------- |
| Group         | `flex flex-col p-1 gap-px`                                             | `pad 4`, `gap 1`                 |
| Heading box   | `mt-1.5 mb-2 px-2`, 15px tall                                          | `margin 6px 0 8px`, `pad 0 8`    |
| Heading type  | `text-xs leading-[14.4px] font-medium text-secondary truncate`         | 12/14.4 500 `texSec`             |
| Trailing sort | `text-xs font-medium text-secondary gap-0.5 rounded-sm`, aligned right | "Beste Übereinstimmungen", `r 4` |

### `Command.Item`

| Property     | `default` / `emoji`                                                         | `description`                                                                                                    | Notion source                    |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Size         | `h-9` (36), full list width                                                 | 54.8 tall                                                                                                        | measured                         |
| Padding      | `px-2 py-1`                                                                 | `p-2`                                                                                                            | `pad 4 8` / `pad 8`              |
| Radius       | `rounded-xl` (12)                                                           | same                                                                                                             | `r 12`                           |
| Pitch        | 37 (1px group gap)                                                          |                                                                                                                  | option y 264.1 → 301.1           |
| Icon box     | `size-5 rounded-[3.5px]`, svg `size-[18px] text-icon-secondary`             | same                                                                                                             | 20×20 box, svg 18 `icoSec`       |
| Icon → label | label starts 28px from the content edge (`gap-2`)                           | same                                                                                                             | icon 254, label 282              |
| Label        | `text-sm leading-5 font-medium`, `text-primary`; recent pages `text-accent` | title `text-sm leading-5 font-medium text-primary`                                                               | 14/20 500 `texPri` / `texAccPri` |
| Match        | —                                                                           | matched span 14/20 500 `text-primary`                                                                            | `<span>` around the match        |
| Badge        | —                                                                           | `px-1 py-0.5 rounded-sm bg-gray-secondary-translucent text-gray-accent text-[11px] leading-[14.3px] font-medium` | `graBacSecTra`, `graTexAccPri`   |
| Second line  | —                                                                           | `text-xs leading-[16.8px] text-tertiary`, parts joined by " • "                                                  | 12/16.8 `texTer`                 |
| Trailing     | template rows hold a 14px `text-icon-secondary` svg at the right edge       | —                                                                                                                | `icoSec`                         |
| Cursor       | `cursor-pointer`                                                            | same                                                                                                             |                                  |
| Overflow     | label `truncate`                                                            | same                                                                                                             |                                  |

### `Command.Empty`

| Property    | Value                                           | Notion source       |
| ----------- | ----------------------------------------------- | ------------------- |
| Placement   | centred horizontally and vertically in the body | screenshot          |
| Title       | `text-sm leading-5 font-medium text-secondary`  | 14/20 500 `texSec`  |
| Description | `text-sm leading-[16.8px] text-tertiary`        | `texTer`            |
| Action link | `text-sm text-blue-accent cursor-pointer`       | `a`, `bluTexAccPri` |

### Footer (hint bar, `CommandShortcut`)

| Property   | Value                                                                          | Notion source                                    |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| Bar        | `h-[41px] pl-4 pr-3 py-2 border-t border-secondary-translucent text-secondary` | `pad 8 12 8 16`, `borSecTra`                     |
| Key glyphs | ⌘ and ↵ as 12×12 svgs, 2px apart, `text-icon-secondary`                        | `icoSec`                                         |
| Hint text  | `text-xs leading-[18px] text-tertiary`, `gap-1.5` after the glyphs             | 12/18 `texTer`                                   |
| Buttons    | `size-6 rounded-md`, 16px icons, `text-primary`; ghost hover                   | `r 6`; with a query, thumbs 20×20 `p-0.5` appear |

### Preview (Notion only)

`aside` 406 wide, holding a 376×520 card: `rounded-xl bg-primary border-t border-primary shadow-lg` (`bacPri`, `borPri`, `shaOutLg`). Removed when the selected row has nothing to preview.

## States

| Part          | State                                    | Change                                                              | Notion source                                                                                  |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Item`        | `data-selected` (pointer or first item)  | `bg-interactive-translucent`                                        | `rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 0) * 1)))`             |
| `Item`        | `data-selected` after arrow-key movement | adds `shadow-focus-button`                                          | `butBluFocRin`, written by script                                                              |
| `Item`        | `:hover`, not selected                   | `bg-interactive-translucent`, no ring; selection stays where it was | hover kept `aria-activedescendant` on the first item                                           |
| `Item`        | `:active`                                | `bg-interactive-translucent-200`                                    | `--x-ph3bdx: rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 2)))` |
| `Item`        | `data-disabled`                          | not observed                                                        |                                                                                                |
| Header button | `:focus-visible` (Tab)                   | `shadow-focus-button`, `bg-blue-interactive-translucent`            | `butBluFocRin`, `bluBacIntTra`                                                                 |
| Header button | `:active`                                | `bg-blue-interactive-translucent-200`                               | `--x-ph3bdx ← bluBacIntTra`                                                                    |
| `Input`       | focused                                  | no ring or border change                                            |                                                                                                |

The ring was absent on the first open after page load. It appeared once ArrowDown moved the selection, and it was still present on a later ⌘K reopen. That matches keyboard-modality tracking rather than `:focus-visible`, because DOM focus stays in the input. Ring geometry: light `0 0 0 2px #f8f8f7, 0 0 0 4px #2383e2, 0 0 0 6px rgb(255 255 255 / 0.25)`; dark `0 0 0 2px #191919, 0 0 0 4px #2383e2, 0 0 0 6px #191919`.

cmdk moves `data-selected` on pointer move by default. To match Notion, set `disablePointerSelection` on `Command` and style hover separately with `hover:bg-interactive-translucent`.

## Motion

| Transition       | Element                 | initial → animate / exit               | Duration | Delay | Ease                   | Origin |
| ---------------- | ----------------------- | -------------------------------------- | -------- | ----- | ---------------------- | ------ |
| open             | dialog wrapper          | snap (`opacity` 0 → 1 over 1ms)        | 0        | 0     |                        |        |
| close            | dialog wrapper          | snap (1ms); removed ~30ms after Escape | 0        | 0     |                        |        |
| selection move   | `Item` background       | transparent ↔ `bacIntTra`              | 0.02     | 0     | `[0.42, 0, 1, 1]`      |        |
| hover in / out   | `Item` background       | same as selection                      | 0.02     | 0     | `[0.42, 0, 1, 1]`      |        |
| ring             | `Item` box-shadow       | snap                                   | 0        | 0     |                        |        |
| layout change    | popup `width`, `height` | to the new size                        | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` |        |
| preview in / out | `aside`                 | `opacity`, `transform`                 | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` |        |
| header buttons   | background              | hover fill                             | 0.1      | 0     | `[0.42, 0, 0.58, 1]`   |        |
| loading          | `Command.Loading`       | `rotate: 0 → 360`, repeat              | 1.2      | 0     | linear                 |        |

On open, Notion also fades its page topbar out (`opacity` 1 → 0, 700ms `ease`) and back in when the pointer moves. That is page chrome, not part of the command menu.

Reduced motion: no rules.

## Interaction

| Part           | Hit area            | Cursor    | Focus-visible                                             |
| -------------- | ------------------- | --------- | --------------------------------------------------------- |
| `Item`         | 572×36, same as box | `pointer` | `shadow-focus-button` after keyboard selection            |
| `Input`        | 866×24              | `text`    | none                                                      |
| Header buttons | 32×32, same as box  | `pointer` | `shadow-focus-button` + `bg-blue-interactive-translucent` |
| Filter chip    | 182×24, same as box | `pointer` | not measured                                              |
| Footer buttons | 24×24, same as box  | `pointer` | not measured                                              |

Placement: not anchored to a trigger; centred horizontally with its top at 9vh. Focus: on open the input is focused, with `aria-activedescendant` on the first item. Tab leaves the input for the first header button ("Hervorhebungsbereich ausblenden"), and Shift+Tab returns. Escape closes and focus goes to `body`, where it was before ⌘K. Arrow keys move the selection; when the selection lands on a row without a preview, the `aside` is removed and the list widens to 978px while the popup size stays fixed.

## Responsive

| Width | Change                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------- |
| 1470  | baseline: popup 1006×634.6, list 600 + preview 406                                                                    |
| all   | no `@media` or `@container` rules on any part; the only conditional rule is a `(forced-colors: active)` focus outline |

Touch: `(pointer: coarse)` rules: none.

## Dark mode

None beyond tokens: `popWaxPapBac` (`#ffffffe6` → `#202020e6`), `shaOutScr` (gains a 1px `#383836` ring), `bacIntTra` and the `butBluFocRin` ring (inner and outer rings become `#191919`) all flip with the theme.

## Gaps

- **Tokens:** `popWaxPapBac` was added to `raw-tokens.txt` and mapped as `bg-popover-frosted`.
- **Not observable:**
  - Resizing the window did not change the viewport (it stayed 1470×715, as in the Dialog spec), so 1440/1024/768/600/400 were not captured.
  - The popup's width (1006) and height (`91vh − 16px`) are set inline by script. How they shrink on narrow viewports is unknown.
- **Not measured:**
  - The non-matching part of a result title. The probe read the matched `<span>` at 14/20 500; the screenshot suggests the surrounding text is lighter.
  - `data-disabled` items: no fixture.
  - A backdrop click: not tried; Escape was used to close.
  - Focus rings on filter chips and footer buttons.
  - The template row's trailing 14px icon, which is in the DOM but not visible in the captures.
- **Missing screenshots:** hover and `description` variants in both themes, and the selected state without the ring.

## Screenshots

`command/default-selected-{light,dark}.png` (first row selected with the keyboard ring), `command/empty-{light,dark}.png` (`empty-dark` at 0.6 scale).
