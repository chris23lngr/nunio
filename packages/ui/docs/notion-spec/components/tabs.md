# Tabs spec

Captured 2026-10-29 from Notion Library (“Bibliothek”) collection-view tabs and the sidebar Home / Chat / Meetings tabs. Base UI: `@base-ui/react/tabs`.

The Library uses `.notion-collection-view-tab` inside `.notion-collection-view-tab-button`, providing a live collection-view reference without a sandbox database. Measurements cover its pill tabs, compact sidebar tabs, and the Library's responsive view picker. They do not establish that every database view has identical styling. Raw probe results and motion traces: [tabs/measurements.json](tabs/measurements.json).

## Variants

| Variant             | Content                                           | Size                                                     | Intent  | Where in Notion                          |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------- | ------- | ---------------------------------------- |
| `view`              | leading icon + label, selected background         | 32px high; captured widths 88.1–176.4px, max width 220px | neutral | Library view tabs                        |
| `sidebar`           | selected icon + label; inactive icon only         | selected Home 80×32, Chat 72.2×32; inactive 32×32        | neutral | Home / Chat / Meetings                   |
| responsive `picker` | view-type icon + current label + trailing chevron | 192.4×32 for Kürzlich verwendet                          | neutral | Library when tab row no longer fits      |
| responsive `more`   | label only, “3 mehr…”                             | 75.8×32 in this capture                                  | neutral | Library with partially overflowing views |

`picker` and `more` are companion popup triggers, not additional `Tabs.Tab` parts. The `view` tabs captured were Kürzlich verwendet, Favoriten, Geteilt, Privat, Smart Notes, and Fähigkeiten. Their widths are content-dependent; do not hardcode the example widths.

## Anatomy

| Base UI part | Notion element                                     | Notes                                                                                                                       |
| ------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Root`       | surrounding collection-view or sidebar state owner | no separate decorated surface; keep application layout outside the primitive                                                |
| `List`       | `div[role=tablist]`                                | Library horizontal 40px strip; sidebar horizontal 32px strip                                                                |
| `Tab`        | `div[role=tab][aria-selected]`                     | Library `.notion-collection-view-tab`; sidebar IDs `sidebar-tab-default-*`                                                  |
| `Indicator`  | no separate element                                | selected background is painted on the active tab; no moving underline or sliding indicator observed                         |
| `Panel`      | sidebar `div[role=tabpanel]`                       | `aria-labelledby` and tab `aria-controls` connect the pair; Library swaps its shared view content without a `tabpanel` role |

Library hierarchy, confirmed with a fresh screenshot and `chain()`: text span → 32px tab → 40px `.notion-collection-view-tab-button` → drag wrapper → tablist. The extra 8px of strip height is outside the clickable tab. Sidebar icons are masked spans, not SVGs; Library icons are separate 20px SVGs.

Use Base UI's tab/panel associations and supported keyboard behavior in nui. The observed Notion DOM is evidence for appearance, not a reason to copy its missing Library panel association or its all-tabs `tabindex=0` behavior.

## Parts

### `List`

| Property     | `view`                                         | `sidebar`                                             | Notion source                                     |
| ------------ | ---------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Layout       | `flex items-center h-10`                       | `flex flex-nowrap h-8 gap-0.5 pl-[3px]`               | 40px and 32px strips; sidebar gap 2px             |
| Surface      | transparent, no border or shadow               | same                                                  | measured                                          |
| Between tabs | `gap-px` equivalent                            | 2px direct-child gap, plus selected-tab margins below | view wrappers have 1px inline-end margin          |
| Width        | available toolbar width                        | captured list 151px                                   | application layout, not intrinsic primitive width |
| Overflow     | `overflow-hidden`; fit-dependent view overflow | nowrap with label collapse                            | live styles and responsive captures               |

The Library list has an 8px inline-start margin inside its toolbar. At the original 1470px viewport its box was 892.1×40; that width includes spare toolbar space, not just the tabs. The Library toolbar also has Filter, Search, and Settings controls outside the list.

### `Tab` — `view`

| Property             | Value                                                       | Notion source                                                        |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Layout               | `flex items-center shrink-0 min-w-0 whitespace-nowrap`      | inline styles                                                        |
| Height / width       | `h-8 w-fit max-w-[220px]`                                   | 32px; captured widths 176.4, 110.9, 93.7, 88.1, 132.5, 125.8px       |
| Padding              | `px-3 py-1.5`                                               | 6px 12px                                                             |
| Radius               | `rounded-[20px]`                                            | 20px                                                                 |
| Border / idle shadow | none                                                        | measured                                                             |
| Font                 | `font-sans text-sm leading-[1.2] font-medium`               | 14/16.8, 500 in both active and inactive states                      |
| Inactive text        | `text-secondary`                                            | inline `texSec`                                                      |
| Active text          | `text-primary`                                              | inline `texPri`                                                      |
| Icon                 | `size-5 shrink-0 mr-1.5`, uses the same text token as label | 20×20, 6px inline-end margin; explicit SVG fill `texPri` or `texSec` |
| Label                | `min-w-0 truncate mt-px`                                    | span has ellipsis, nowrap, 1px top margin                            |
| Cursor               | `cursor-pointer`                                            | tab; outer drag wrapper is `grab`                                    |
| Transition           | `transition-[background] duration-100 ease-in-out`          | 100ms background animation                                           |

The role-based icon lookup can offer `icoAccPri` or `icoSec` as equal-color candidates. Here the actual SVG styles explicitly use text tokens, so retain `text-primary` / `text-secondary` inheritance for the icon.

### `Tab` — `sidebar`

| Property                      | Value                                                                                 | Notion source                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Height / radius               | `h-8 rounded-lg`                                                                      | 32px, 8px radius                                                         |
| Inactive size / padding       | `size-8 px-[5px]`                                                                     | 32×32; 22px icon wrapper                                                 |
| Active size / padding         | content width; `pl-[5px] pr-0`                                                        | Home 80px, Chat 72.2px                                                   |
| Active margins                | 4px inline-end for Home; 4px on both inline sides for Chat                            | actual inline margins after selection                                    |
| Layout                        | `flex items-center justify-center min-w-0`                                            | measured styles                                                          |
| Text                          | `text-sm leading-[1.2] font-medium`; inactive `text-secondary`, active `text-primary` | 14/16.8, 500                                                             |
| Icon frame                    | `size-[22px] flex items-center justify-center`                                        | measured frame                                                           |
| Masked icon                   | `size-5`; captured fill `bg-[#55534e]`                                                | inline mask background, untokenized; dark limitation below               |
| Inactive icon opacity         | `opacity-50` on the 22px wrapper                                                      | active wrapper has full opacity                                          |
| Label                         | `pl-1.5 whitespace-nowrap`                                                            | 6px inset                                                                |
| Label reveal                  | outer grid `grid-cols-[0fr]` inactive → `grid-cols-[1fr]` active; clipped inner span  | actual grid styles                                                       |
| Active label trailing padding | `pr-2` with a fade mask                                                               | mask is `linear-gradient(to right, black calc(100% - 8px), transparent)` |
| Transition                    | padding, margin, and label grid tracks, 200ms ease-out                                | measured trace and declarations                                          |

Active width changes with the label. The full tab is not a fixed-width segmented control. Sidebar hover does not itself expand the label; selecting another panel does.

### Responsive companion controls

| Property        | Current-view `picker`                            | `more`                                             |
| --------------- | ------------------------------------------------ | -------------------------------------------------- |
| Size            | `h-8 max-w-[220px]`, captured 192.4px wide       | `h-8`, captured 75.8px wide                        |
| Padding         | `px-2.5 py-1.5`                                  | same                                               |
| Radius          | `rounded-full` (computed 9999px)                 | `rounded-[20px]`                                   |
| Font            | `text-sm leading-[1.2] font-medium text-primary` | `text-sm leading-[1.2] font-normal text-secondary` |
| Idle background | `bg-interactive-translucent`                     | transparent                                        |
| Leading icon    | `size-5 mr-1.5 text-primary`, view-type icon     | absent                                             |
| Label           | `truncate mr-1`                                  | plain count + “mehr…”                              |
| Chevron         | `size-4 text-icon-tertiary`                      | absent                                             |

Both open the same view chooser containing all six views, including ones already visible in the strip. Captured chooser: 290×224, `rounded-[10px] bg-popover shadow-lg`, bottom/end placement with 4px gap, 28px option rows, and a search combobox receiving focus. Its input and list rows belong to Input/Combobox/Menu styling rather than the Tabs primitive. The 224px height is fixture content, not a fixed-height requirement.

## States

| Part          | State             | Change                                                              | Notion source                                  |
| ------------- | ----------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `Tab`         | inactive idle     | transparent background, secondary label/icon color                  | both themes                                    |
| `Tab`         | `data-active`     | `bg-interactive-translucent text-primary`                           | `aria-selected=true`, `bacIntTra`, `texPri`    |
| `Tab`         | inactive `:hover` | `bg-interactive-translucent`; secondary text remains                | measured hover                                 |
| `Tab`         | active `:hover`   | `bg-interactive-translucent-150`                                    | resolved rule, 1.5× alpha                      |
| `Tab`         | `:focus-visible`  | `shadow-focus-button`, with inactive/active hover fill respectively | real Tab / Shift+Tab; `butBluFocRin`           |
| `Tab`         | `:active`         | `bg-interactive-translucent-200`                                    | stylesheet rule, 2× alpha                      |
| sidebar `Tab` | inactive / active | hide / reveal label; icon wrapper opacity 0.5 / 1                   | actual selection                               |
| `Panel`       | active changes    | replace the displayed content                                       | Library route/view swap and sidebar panel swap |
| `Tab`         | `data-disabled`   | unobserved                                                          | no disabled fixture                            |

The light probe sometimes prints `bacIntTra×1.53` for the active hover. The resolved expression establishes **1.5**, rather than a new 1.53 multiplier; this discrepancy is color/alpha quantization. One immediate Escape sample landed mid-transition and printed 1.41; use settled real-Tab focus samples.

Resolved rules, preserved verbatim (probe token shorthand):

```css
/* Active hover/focus-visible: default --btn-adj-mult is 1. */
background: rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 1)));
/* Inactive hover/focus-visible: default is 0. */
background: rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 0) * 1)));
/* Pressed: default is 1, producing 2× alpha. */
background: rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 2)));
```

In nui these resolve through `--n-bacIntTra`; the current stylesheet already maps 1.5× and 2× interaction utilities. Do not use `bg-hover` simply because its value might look close.

## Motion

| Transition         | Element             | initial → animate / exit                                            | Duration | Delay | Ease                   | Origin    |
| ------------------ | ------------------- | ------------------------------------------------------------------- | -------- | ----- | ---------------------- | --------- |
| hover in/out       | view tab            | transparent ↔ `bacIntTra`; active uses `bacIntTra` ↔ 1.5× alpha     | 0.1s     | 0     | `[0.42, 0, 0.58, 1]`   | —         |
| activate view      | old / new tab       | old selected fill → transparent; new fill → selected/hover fill     | 0.1s     | 0     | `[0.42, 0, 0.58, 1]`   | —         |
| activate sidebar   | label grid          | `{ gridTemplateColumns: "0fr" }` ↔ `{ gridTemplateColumns: "1fr" }` | 0.2s     | 0     | `[0, 0, 0.58, 1]`      | —         |
| activate sidebar   | tab padding/margins | 5px trailing padding ↔ 0; selected margins appear/disappear         | 0.2s     | 0     | `[0, 0, 0.58, 1]`      | —         |
| sidebar hover      | tab background      | same semantic fills as view tabs                                    | snap     | 0     | —                      | —         |
| open view chooser  | popup wrapper       | `{ opacity: 0, scale: 0.96 }` → `{ opacity: 1, scale: 1 }`          | 0.2s     | 0     | `[0.25, 0.1, 0.25, 1]` | top right |
| close view chooser | popup wrapper       | exit `{ opacity: 0, scale: 0.96 }`                                  | 0.2s     | 0     | `[0.25, 0.1, 0.25, 1]` | same      |

Use Motion `transition={{ duration: 0.1, ease: [0.42, 0, 0.58, 1] }}` for view-tab background if implementing it in Motion; sidebar reveal uses `duration: 0.2` with ease-out. Sidebar inline transition declarations cover padding/margin rather than background, and pointer-hover recording captured no tab-background animation. The sidebar grid transition is declared as 0fr/1fr; the recorder's computed grid keyframes sometimes print equal pixel values, so the original grid declaration is the source for those endpoints.

There is no separate sliding indicator and no measured panel slide/fade. Library and sidebar activation replace content; loading skeleton shimmer in the trace is asynchronous content loading, not Tabs motion. Color and icon-opacity changes had no captured dedicated animation. A sidebar tooltip fade appeared while hovering; its 50ms fade belongs to Tooltip, not tab activation. No tab hover activates a panel.

Reduced motion: `rules()` returned no `prefers-reduced-motion`, pointer-coarse, or component-specific media/container override for the inspected lists, wrappers, tabs, labels, and icons. Runtime reduced-motion emulation was not performed.

## Interaction

| Part                        | Hit area                                 | Cursor  | Focus-visible                                           |
| --------------------------- | ---------------------------------------- | ------- | ------------------------------------------------------- |
| view tab Kürzlich verwendet | visual 176.4×32; pixel-grid probe 177×32 | pointer | `shadow-focus-button`                                   |
| view tab Favoriten          | visual 110.9×32; probe 111×32            | pointer | same                                                    |
| inactive sidebar tab        | 32×32                                    | pointer | same                                                    |
| active sidebar Chat         | visual 72.2×32; probe 73×32              | pointer | same                                                    |
| collapsed view picker       | visual 192.4×32; probe 193×32            | pointer | same, confirmed by real Tab                             |
| more trigger                | 75.8×32; probe 76×32                     | pointer | same rule; independently tab-focused state not captured |

Pixel-grid rounding is not an expanded hit region. The 40px view wrapper and its drag cursor do not expand the 32px tab hit area. Dragging/reordering was not exercised.

Clicking Favoriten opens its view and updates the URL to `/library/favorites`; clicking Kürzlich verwendet restores `/library/recents`. Focus remains on the clicked tab. Switching Home/Chat replaces only the sidebar panel; Home was restored after capture. No content, tab order, or view configuration was edited.

Notion's Library has `tabindex=0` on every tab. In the captured keyboard test, ArrowRight from focused Favoriten changed neither focused tab nor selected view. Keep Base UI's accessible arrow navigation and `activateOnFocus` contract; its documented default is manual activation (`false`). Do not infer automatic activation, looping, or Home/End behavior from this Notion test.

For the responsive chooser, Enter from the keyboard-focused picker opens the search field; Escape returns focus to the picker. Mouse opening while another sidebar control was focused instead returned to that previously focused control in some captures. Real Tab navigation was used separately to establish the picker's own focus ring, rather than attributing those sidebar rings to it. Chooser rows were not selected, since view navigation was already measured directly in the tab strip.

Forced-colors focus-visible rules: 2px solid transparent outline, 2px outline offset; ordinary `:focus` suppresses outline. Keep semantic labels and tab/panel relationships even when a compact label is visually collapsed.

## Responsive

Viewport height was 693px; the desktop sidebar stayed open. The fit behavior therefore depends on the remaining content width, not viewport width alone. Do not turn these samples into unmeasured CSS breakpoints.

| Width | Change                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------- |
| 1440  | six 32px tabs visible; list 864.9×40; view tabs keep their intrinsic widths                                     |
| 1024  | list 461.8×40; first three tabs visible, remaining three accessible through “3 mehr…”                           |
| 768   | list 255.7×40; no `role=tab` elements in Library; current-view picker replaces the tab row                      |
| 600   | list 94×40; picker keeps its 192.4px content width and is clipped by the toolbar                                |
| 400   | list 0×40 with the open desktop sidebar and page gutters; picker remains in DOM but tablist clips it completely |

Sidebar list remains 151×32 in all five samples; active Home remains expanded. Library view tabs do not wrap, shrink into smaller pills, or turn into an underline style. This capture does not specify how the app behaves with the sidebar closed or a mobile user agent.

View chooser placement measured at 768px: bottom/end, 4px gap, 290×224, origin `100% top`; the more chooser at 1024px uses the same placement. Near-edge popup clamping for these companion surfaces was not independently forced. Tabs themselves have no floating placement.

## Dark mode

Library typography, geometry, SVG sizing, and motion stay unchanged. Semantic utilities flip normally: `text-primary`, `text-secondary`, `bg-interactive-translucent`, derived interaction fills, `bg-popover`, `shadow-lg`, and `shadow-focus-button`.

**Sidebar mask limitation:** its icon spans use an inline `rgb(85, 83, 78)` (`#55534e`) background under a CSS mask. The probe's class-only theme swap does not recompute this JavaScript-supplied color. It remained the same in locally dark captures. Record that literal as observed, but do not infer that native Notion dark mode deliberately uses this light-mode icon color. A genuine dark-rendered icon fixture is required to resolve that gap without changing account settings.

## Gaps

- **Untokenized:** sidebar mask fill `#55534e`, with inactive icon-wrapper opacity 0.5. Its true dark-rendered value is not established by the local theme swap.
- **Unmapped tokens:** none for Library tab fills, text, popover surfaces, or shadows. Derived 1.5× and 2× utilities already exist.
- **Not observable:** disabled tabs, text-only standard tabs, badges/counts inside a tab, vertical tablists, and database-specific view/menu differences were absent from these fixtures. No database fixture was needed for the measured Library component.
- **Keyboard:** only the stated focus traversal, ArrowRight test, and picker Enter/Escape behavior were exercised. Space, Home/End, looping, and automatic activation were not established. More-trigger keyboard focus was not separately captured.
- **Motion:** sidebar icon-opacity changes and content-panel transitions have no measured dedicated animation. No separate animated indicator was found. Skeletons and tooltip fades are excluded from Tabs motion.
- **Responsive:** fit boundaries were sampled, not binary-searched. Sidebar-closed layout, genuine mobile/touch behavior, chooser collision flipping, and native forced-colors/reduced-motion modes were not tested. Narrow desktop clipping is recorded, not corrected.
- **Companion chooser:** search field/row dimensions beyond the overview above are not a complete Combobox spec; these measurements only establish the responsive Tabs handoff.

## Screenshots

| State                           | Light                                        | Dark                                       |
| ------------------------------- | -------------------------------------------- | ------------------------------------------ |
| View tabs, idle                 | [light](tabs/view-idle-light.png)            | [dark](tabs/view-idle-dark.png)            |
| Inactive view hover             | [light](tabs/view-inactive-hover-light.png)  | [dark](tabs/view-inactive-hover-dark.png)  |
| Selected view hover             | [light](tabs/view-selected-hover-light.png)  | [dark](tabs/view-selected-hover-dark.png)  |
| View keyboard focus             | [light](tabs/view-focus-light.png)           | [dark](tabs/view-focus-dark.png)           |
| Sidebar Chat selected           | [light](tabs/sidebar-active-light.png)       | [dark](tabs/sidebar-active-dark.png)       |
| Sidebar pointer hover           | [light](tabs/sidebar-hover-light.png)        | [dark](tabs/sidebar-hover-dark.png)        |
| Sidebar keyboard focus          | [light](tabs/sidebar-focus-light.png)        | [dark](tabs/sidebar-focus-dark.png)        |
| Collapsed picker idle           | [light](tabs/view-collapsed-idle-light.png)  | [dark](tabs/view-collapsed-idle-dark.png)  |
| Collapsed picker hover          | [light](tabs/view-collapsed-hover-light.png) | [dark](tabs/view-collapsed-hover-dark.png) |
| Collapsed picker keyboard focus | [light](tabs/view-collapsed-focus-light.png) | [dark](tabs/view-collapsed-focus-dark.png) |
| Collapsed picker open           | [light](tabs/view-collapsed-open-light.png)  | [dark](tabs/view-collapsed-open-dark.png)  |
| More views open                 | [light](tabs/view-more-open-light.png)       | [dark](tabs/view-more-open-dark.png)       |

Responsive: [1440](tabs/view-width-1440.png), [1024](tabs/view-width-1024.png), [768](tabs/view-width-768.png), [600](tabs/view-width-600.png), [400](tabs/view-width-400.png). Full viewport captures may contain incidental focus rings or tooltips elsewhere; the labeled view-tab state refers to the Library strip. Sidebar element crops isolate the tablist, with focus-ring edges potentially clipped by the crop.
