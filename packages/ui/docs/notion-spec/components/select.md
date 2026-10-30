# Select spec

Captured 2026-10-29 from Notion Settings → Meine Einstellungen → Design (Appearance), with Hoher Kontrast (High contrast) as a matching popup and the disabled Zeitzone (Timezone) trigger as a disabled fixture. Base UI: `@base-ui/react/select`.

The standard settings select is an outlined, content-width trigger with a downward chevron, opening a separate popup below it. The selected option has a trailing checkmark. Measurements and motion traces are saved in [select/measurements.json](select/measurements.json). No option was selected and no account setting was changed. Dark mode was applied locally with the probe, then restored to light.

## Variants

| Variant                  | Content                                                                                | Size                                                             | Intent  | Where in Notion                                   |
| ------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------- | ------------------------------------------------- |
| `default`                | label + trailing chevron; popup has text rows and a trailing check on the selected row | trigger 230.3×28, popup 250×94                                   | neutral | Design; Hoher Kontrast                            |
| `default`, shorter value | label + trailing chevron; same trigger geometry except content width                   | Standard 93×28; Relativ 77.2×28; Zuletzt besuchte Seite 181.7×28 | neutral | Zahlenformat; Datumsformat; Beim Start öffnen     |
| `default`, disabled      | label + trailing chevron, whole trigger at 0.4 opacity                                 | 153.1×28                                                         | neutral | Zeitzone, with automatic timezone already enabled |

These are content and state differences within one visual style. No additional size or intent was observed in this settings surface. The Design options are “Systemeinstellung verwenden”, “Hell”, and “Dunkel”; the first was already selected. High contrast uses the same three-row geometry, with “Standardkontrast” and “Hoher Kontrast” as its other options.

## Anatomy

| Base UI part                       | Notion element                                         | Notes                                                                |
| ---------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| `Root`                             | state owned by the settings control                    | no visual box                                                        |
| `Label`                            | “Design” text, referenced by trigger `aria-labelledby` | 14/20, weight 500                                                    |
| `Trigger`                          | `div[role=button][aria-haspopup=dialog]`               | 230.3×28; `aria-expanded`; associated description                    |
| `Value`                            | trigger's `span`                                       | 197.7×16.8 for the captured value                                    |
| `Icon`                             | `svg.arrowChevronSingleDownSmall`                      | 8.6×14 actual SVG box; no rotation observed on open                  |
| `Portal`                           | popup overlay outside the settings content             | render outside clipping ancestors                                    |
| `Backdrop`                         | no visible select-specific backdrop                    | Settings has its own existing modal backdrop                         |
| `Positioner`                       | wrappers around the popup                              | bottom/end, 4px gap; animated wrapper origin `100% top`              |
| `Popup`                            | inner `div[role=dialog]`                               | 250×94, radius 10, popover surface and shadow                        |
| `List`                             | `div[role=menu]` plus padded flex column               | menu owns focus and `aria-activedescendant`                          |
| `Item`                             | `div[role=menuitem]` and inner content row             | outer row 242×28, inner row has horizontal padding and typography    |
| `ItemText`                         | descendant `div[role=presentation]`                    | single line, ellipsis; 202px available when checked, 226px otherwise |
| `ItemIndicator`                    | trailing wrapper with `svg.checkmarkSmall`             | 16×16, present only on the selected row                              |
| `Arrow`                            | absent                                                 | chevron on the trigger is separate                                   |
| `Group`, `GroupLabel`, `Separator` | absent in the observed Design and High contrast lists  | no invented group decoration                                         |
| `ScrollUpArrow`, `ScrollDownArrow` | absent in these short lists                            | scroller exists, overflow behavior not exercised                     |

Notion's runtime IDs are session-specific. For this capture the trigger referenced `:rq3:` (label), `:rq5:` (value), and `:rq4:` (description); do not hardcode those IDs. Resolve the control by its accessible name “Design Systemeinstellung verwenden”. Fresh screenshot coordinates and `__nui.chain()` confirmed the inner text → content row → menuitem → list wrapper hierarchy.

Use Base UI's select semantics for nui; the observed Notion menu roles describe its DOM, not a requirement to replace select semantics. Set `alignItemWithTrigger={false}` so Base UI does not overlap the trigger by default.

## Parts

### `Trigger`, `Value`, `Icon`

| Property   | Value                                                      | Notion source                                               |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| Layout     | `flex items-center justify-center gap-1.5`                 | centered flex layout, 6px gap; border-box sizing            |
| Size       | `h-7 w-fit`                                                | 28px high, width follows value; computed flex-shrink is 1   |
| Padding    | `px-2 py-0`                                                | 0 8px, plus 1px border                                      |
| Radius     | `rounded-md`                                               | 6px                                                         |
| Border     | `border border-primary-translucent`                        | 1px solid `borPriTra`                                       |
| Background | `bg-transparent`                                           | idle, both themes                                           |
| Shadow     | `shadow-none`                                              | idle                                                        |
| Text       | `font-sans text-sm leading-[1.2] font-medium text-primary` | 14/16.8, 500, `texPri`                                      |
| Cursor     | `cursor-pointer`                                           | enabled trigger                                             |
| Chevron    | `h-3.5 w-[8.6px] shrink-0 text-icon-secondary`             | actual box about 8.6×14, viewBox `3.06 0 9.88 16`; `icoSec` |
| Transition | background, 20ms, ease-in                                  | `tr background 0.02s ease-in`                               |

Chevron width is rounded to the probe's 0.1px precision; it is not a square icon. The captured trigger width is content, padding, border, gap, and chevron combined; do not use 230.3px as a fixed width.

### `Label` and description

| Part        | Value                                                                 | Notion source           |
| ----------- | --------------------------------------------------------------------- | ----------------------- |
| Label       | `text-sm leading-5 font-medium text-primary`                          | 14/20, 500, `texPri`    |
| Description | `text-[13px] leading-[18px] font-normal text-secondary`               | 13/18, 400, `texSec`    |
| Association | label and value name the trigger; description uses `aria-describedby` | live trigger attributes |

### `Popup`, `List`

| Property        | Value                                              | Notion source                                                                             |
| --------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Width           | `w-[250px] min-w-[180px] max-w-[calc(100vw-24px)]` | live popup container variables                                                            |
| Height          | content height; Design popup 94px                  | 3×28px + 2×1px gaps + 2×4px padding                                                       |
| Max height      | `max-h-[400px]`                                    | live container variable; short list never reaches it                                      |
| Radius          | `rounded-[10px]`                                   | 10px                                                                                      |
| Surface         | `bg-popover`                                       | light white, dark `popBac`; do not use `bg-primary` just because it matches in light mode |
| Border / shadow | no separate border; `shadow-lg`                    | `shaOutLg`, includes outline ring                                                         |
| Overflow        | popup `overflow-hidden`, inner vertical scroller   | observed anatomy                                                                          |
| List layout     | `flex flex-col gap-px p-1`                         | 4px padding, 1px gap                                                                      |
| Origin          | `origin-[var(--transform-origin)]`                 | measured wrapper `100% top` at bottom/end placement                                       |

### `Item`, `ItemText`, `ItemIndicator`

| Property           | Value                                                      | Notion source                                                                    |
| ------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Item size          | `h-7 w-full rounded-md`                                    | 242×28 inside the 250px popup                                                    |
| Content layout     | `flex min-h-7 w-full items-center gap-2 px-2`              | inner row 0 8px padding, 8px gap                                                 |
| Text               | `font-sans text-sm leading-[1.2] font-normal text-primary` | **inner content** 14/16.8, 400; outer menuitem inherits 16/24                    |
| Text overflow      | `min-w-0 flex-1 truncate`                                  | text box 202px selected, 226px unselected                                        |
| Background         | `bg-transparent`                                           | idle, including selected-only row in initial open capture                        |
| Border / shadow    | none at idle                                               | measured                                                                         |
| Cursor             | `cursor-pointer`                                           | every enabled option                                                             |
| Selected indicator | trailing `size-4 shrink-0 text-primary`                    | 16×16 SVG; explicitly inherits `texPri` rather than generic secondary icon color |
| Transition         | background, 20ms, ease-in                                  | measured option hover animation                                                  |

## States

| Part            | State                       | Change                                                           | Notion source                                                         |
| --------------- | --------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Trigger`       | `:hover`                    | `bg-interactive-translucent`                                     | `bacIntTra`                                                           |
| `Trigger`       | `data-popup-open`           | same interactive background while open                           | inline background assigned by Notion                                  |
| `Trigger`       | `:focus-visible`            | interactive background + `shadow-focus-button`                   | real Tab then Shift+Tab focus; `butBluFocRin`, both themes            |
| `Trigger`       | `:active` / held press      | `bg-interactive-translucent-150`                                 | stylesheet expression below; measured through rules, not a held press |
| `Trigger`       | `data-disabled`             | `opacity-40 cursor-default`; no hover fill                       | already-disabled timezone fixture; `tabindex=-1`                      |
| `Item`          | pointer hover               | `bg-interactive-translucent`                                     | real hover in both themes                                             |
| `Item`          | keyboard `data-highlighted` | same background + `shadow-focus-button`                          | arrow key updates `aria-activedescendant`; ring appears on active row |
| `Item`          | `data-selected`             | trailing check only                                              | initial selected row has transparent fill and no ring                 |
| `Item`          | selected + highlighted      | check remains, highlight background and ring apply independently | selected-highlighted captures                                         |
| `Item`          | `:active`                   | `bg-interactive-translucent-200`                                 | stylesheet expression below                                           |
| `ItemIndicator` | selection changes           | not observed                                                     | selecting would change an account setting                             |

Keep keyboard highlighting separate from pointer hover: the initial pointer-only row had no ring; after keyboard navigation Notion may retain the ring when the pointer moves to another active row. Pointer hover and a keyboard-active row can also coexist on different rows. Do not apply a focus ring to every hovered row.

Resolved rules, preserved verbatim:

```css
/* Trigger hover and focus-visible: default --btn-adj-mult is 0. */
background: rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 0) * 1)));
/* Trigger active: 1.5× alpha. */
background: rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5)));
/* Item hover: default --btn-adj-mult is 0. */
background: rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 0) * 1)));
/* Item active: default --btn-adj-mult is 1, so 2× alpha. */
background: rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 2)));
```

These probe expressions use token names as shorthand; utilities resolve to `--n-bacIntTra` in nui. The current generated stylesheet already exposes both derived alpha utilities.

## Motion

| Transition            | Element          | initial → animate / exit                                       | Duration         | Delay | Ease                   | Origin                                      |
| --------------------- | ---------------- | -------------------------------------------------------------- | ---------------- | ----- | ---------------------- | ------------------------------------------- |
| open                  | popup wrapper    | `{ opacity: 0, scale: 0.96 }` → `{ opacity: 1, scale: 1 }`     | 0.2s             | 0     | `[0.25, 0.1, 0.25, 1]` | top right for captured bottom/end placement |
| close                 | popup wrapper    | exit `{ opacity: 0, scale: 0.96 }`                             | 0.2s             | 0     | `[0.25, 0.1, 0.25, 1]` | same                                        |
| hover in              | option           | transparent → `bacIntTra`                                      | 0.02s            | 0     | `[0.42, 0, 1, 1]`      | —                                           |
| keyboard highlight    | option           | transparent → `bacIntTra`; focus ring appears                  | background 0.02s | 0     | `[0.42, 0, 1, 1]`      | —                                           |
| open/close background | trigger          | transparent ↔ `bacIntTra`                                      | 0.02s            | 0     | `[0.42, 0, 1, 1]`      | —                                           |
| hover out             | trigger / option | interactive fill → transparent when no active state retains it | declared 0.02s   | 0     | `[0.42, 0, 1, 1]`      | —                                           |

Opening and closing opacity/scale, option hover-in, keyboard fill, and trigger background restoration were captured with `record()` / `stop()`. Close trace removed the popup about 202ms after its exit styles were written. The isolated option hover-out trace was empty because active-state retention can keep the fill; its duration above is the measured CSS declaration, not an observed fade in that trace. The focus ring had no captured animation. No chevron rotation or indicator animation was observed.

Use Motion `transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}` for popup opacity/scale; keep the popup mounted until exit completes. There is no hover-open delay: hover does not open this select.

Reduced motion: `rules()` found no `prefers-reduced-motion` override on the observed popup, wrapper, list, or descendants. Runtime behavior with reduced-motion emulation was not tested.

## Interaction

| Part               | Hit area                                                           | Cursor  | Focus-visible                                  |
| ------------------ | ------------------------------------------------------------------ | ------- | ---------------------------------------------- |
| `Trigger`          | visual 230.3×28; probe grid reports 231×28, no expanded hit region | pointer | `shadow-focus-button`                          |
| `Item`             | 242×28, same as visual box                                         | pointer | active keyboard row gets `shadow-focus-button` |
| disabled `Trigger` | visual 153.1×28; probe grid reports 154×28                         | default | excluded from tab order, not focused           |

The 1px rounded hit-area discrepancy comes from the probe's inclusive pixel sampling, not deliberate target padding. Icons and value are within their parent's hit target.

Placement: `side="bottom" align="end" sideOffset={4} alignItemWithTrigger={false}`. Measured popup right edge is within 0.4px of trigger right edge at normal widths. At a 400px viewport the popup moves left to x=138, right=388, keeping 12px from the viewport edge even though the Settings content clips its trigger. Keep collision handling enabled.

Clicking the trigger focuses the menu container. Arrow keys change its virtual active descendant; the current selection stays unchanged. Escape animates the popup closed and restores focus to the trigger, with the keyboard focus ring visible. Real Tab/Shift+Tab navigation confirms the trigger's focus-visible treatment. In isolated reopens, typing `d` or `h` left the active descendant on “Systemeinstellung verwenden”; typeahead movement was not observed. Keep Base UI's supported typeahead behavior rather than inferring Notion behavior from the earlier hover/keyboard sequence. Enter/Space selection was intentionally not exercised.

The label and helper text sit outside the trigger. Disabled timezone opacity applies to the entire trigger, including text, border, and chevron. There is no disabled option in the three Design choices.

## Responsive

All measurements used viewport height 693px and a desktop pointer. Each width has a saved screenshot.

| Width | Change                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1440  | baseline: trigger 230.3×28, popup 250×94, rows 242×28; bottom/end, 4px gap                                                                       |
| 1024  | no component geometry change; placement follows dialog                                                                                           |
| 768   | no component geometry change; Settings text wraps and moves trigger to y=325, popup y=357                                                        |
| 600   | no component geometry change; trigger y=399, popup y=431                                                                                         |
| 400   | no component geometry change; trigger x=260, y=519, extends beyond Settings content clip; popup clamps to x=138, y=551, 12px from viewport right |

The popup did not become a sheet or full-width surface. Its declared max width is `calc(100vw - 24px)`, min width 180px, max height 400px. Behavior below the tested range is not inferred.

Touch: no `(pointer: coarse)` or component-specific media/container rules returned for the measured trigger, popup wrapper, list, or options. Forced-colors focus-visible rules do exist: transparent 2px solid outline with a 2px offset. Native mobile behavior was not observed.

## Dark mode

Geometry and motion are unchanged. Use the same semantic utilities: `text-primary`, `text-icon-secondary`, `border-primary-translucent`, `bg-interactive-translucent`, `bg-popover`, `shadow-lg`, and `shadow-focus-button`. The popup background reverse lookup is ambiguous in light mode because several tokens are white; dark mode identifies the popover surface. No extra dark-only geometry or component override was observed.

## Gaps

- **Untokenized:** none in the captured component colors or shadows. Transparent backgrounds and dimension values are intentional.
- **Unmapped tokens:** none for the observed style. `bacIntTra` 1.5× and 2× alpha already have generated nui utilities; the original rule also permits runtime `--btn-adj-mult` adjustments not exercised here.
- **Not observable:** disabled options, read-only, required, invalid/valid, touched/dirty, placeholder/empty value, long-list scrolling, scroll arrows, grouped options, separators, leading icons, descriptions inside options, and multiple selection were absent from the supplied Design fixture. They are not claimed to share measured styling.
- **Selection changes:** account changes are outside this observation-only capture, so selection commit behavior and checkmark enter/exit motion remain unmeasured.
- **Other surfaces:** filter-condition Select remains unmeasured; the user supplied Settings as the standard reference. Other settings trigger widths were surveyed, and High contrast's popup confirmed the same row anatomy; other settings popups are not exhaustively specified here.
- **Motion:** no independent option hover-out animation was captured; no runtime reduced-motion or forced-colors emulation was performed.
- **Responsive:** observed narrow desktop Settings clipping is recorded, not corrected. Touch/mobile-user-agent layout and vertical collision flipping were not tested.

## Screenshots

All paths below are relative to this document. Full viewport captures retain the surrounding settings layout for context.

| State                                      | Light                                                   | Dark                                                  |
| ------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------- |
| Trigger idle                               | [light](select/settings-idle-light.png)                 | [dark](select/settings-idle-dark.png)                 |
| Trigger hover                              | [light](select/settings-hover-light.png)                | [dark](select/settings-hover-dark.png)                |
| Trigger keyboard focus                     | [light](select/settings-focus-light.png)                | [dark](select/settings-focus-dark.png)                |
| Popup open, selected check                 | [light](select/settings-open-light.png)                 | [dark](select/settings-open-dark.png)                 |
| Unselected option hover                    | [light](select/settings-option-hover-light.png)         | [dark](select/settings-option-hover-dark.png)         |
| Keyboard active option                     | [light](select/settings-keyboard-light.png)             | [dark](select/settings-keyboard-dark.png)             |
| Selected option after keyboard interaction | [light](select/settings-selected-hover-light.png)       | [dark](select/settings-selected-hover-dark.png)       |
| Selected option retaining active highlight | [light](select/settings-selected-highlighted-light.png) | [dark](select/settings-selected-highlighted-dark.png) |
| Disabled timezone                          | [light](select/settings-disabled-light.png)             | [dark](select/settings-disabled-dark.png)             |

Responsive: [1440](select/settings-width-1440.png), [1024](select/settings-width-1024.png), [768](select/settings-width-768.png), [600](select/settings-width-600.png), [400](select/settings-width-400.png).
