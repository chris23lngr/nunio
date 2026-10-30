# Input spec

Captured 2026-10-28 from the nui sandbox page in app.notion.com: command search (⌘K), page-menu search (Aktionen), and the sharing recipient field (Teilen). Base UI: `@base-ui/react/input`.

Measurements describe native inputs separately from their surrounding frames. Search icons, recipient chips, popup positioning, and combobox behavior belong to the composing component; they are not extra Base UI Input parts. No text was entered and no invitation or workspace change was submitted.

Implemented in `src/components/ui/input.tsx` and `src/components/ui/input-group.tsx`, following shadcn's split. `Input` is the standalone settings field (28px high, 10px horizontal padding, translucent background, outward ring). Framed inputs compose `InputGroup` with `InputGroupAddon` (icons, text, `InputGroupButton`) and a bare `InputGroupInput`: `variant="default"` is menu search, `"inset"` settings search, `"outline"` the recipient field. Clicking an addon focuses the input, and only the input's focus rings the frame. The borderless 16/24 command input belongs to Command (shadcn's `CommandInput`). Native props, refs, Field integration and state-dependent `className` callbacks pass through to Base UI. Disabled borrows Button's measured `opacity-40`; validation states have no styling.

## Variants

| Appearance                       | Content                                           | Measured size                                | Where in Notion                                    |
| -------------------------------- | ------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `default`                        | filled profile-name input                         | frame 250×28, input 230×20; padding 4px 10px | Settings, “Bevorzugter Name”                       |
| `search` frame + `compact` input | leading search icon + input                       | frame 224×28; input 182×20                   | Settings search; padding 4px 6px                   |
| `compact`                        | leading search icon + input                       | frame 232×28; input 198×20                   | Page menu, placeholder “Suchaktionen…”             |
| `recipient`                      | empty recipient input inside a chip-capable frame | frame 335.8×32; input 325.8×24               | Share, “E-Mail oder Gruppe, durch Kommas getrennt” |
| `command`                        | borderless search input                           | input 866×24; containing row 928×48          | ⌘K, “Christoph durchsuchen oder Frage stellen…”    |

Widths are observations at a 1470×697 viewport, not proposed fixed Input widths. The recipient frame is a composition example, not evidence that every plain form input has identical geometry.

## Anatomy

| Base UI part                      | Notion element                                          | Notes                                    |
| --------------------------------- | ------------------------------------------------------- | ---------------------------------------- |
| `Input`                           | Native `input[type=text]`                               | Base UI Input has a single part          |
| Composed frame                    | Parent of menu input; third ancestor of recipient input | Owns radius, background and focus shadow |
| Composed icon                     | Menu frame's `svg`                                      | 16×16; measured separately               |
| Field label / description / error | No corresponding fixture measured                       | Separate Field specification required    |

The menu input was resolved by `input[placeholder="Suchaktionen…"]`, the recipient by `input[placeholder="E-Mail oder Gruppe, durch Kommas getrennt"]`. `__nui.chain` confirmed the menu input's frame at (1214,56), with its input at (1242,60), in the baseline viewport. Resolve again after layout changes.

## Parts

### Native input

| Property                 | Compact                                                | Recipient              | Command                           |
| ------------------------ | ------------------------------------------------------ | ---------------------- | --------------------------------- |
| Type                     | `text-sm leading-5 font-normal`                        | same                   | `text-base leading-6 font-normal` |
| Height                   | 20px content                                           | 24px including padding | 24px                              |
| Padding                  | `p-0`                                                  | `p-0.5`                | `p-0`                             |
| Background               | `bg-transparent`                                       | same                   | same                              |
| Text                     | `text-primary` (`texPri`)                              | same                   | same                              |
| Border / radius / shadow | none / 0 / none                                        | same                   | same                              |
| Cursor                   | `cursor-text`                                          | same                   | same                              |
| Placeholder              | `placeholder:text-primary placeholder:opacity-[0.375]` | same                   | same                              |

Placeholder computed color is the primary text color, with a separate opacity of 0.375: light `rgb(44,44,43)`, dark `rgb(240,239,237)`. Do not substitute `text-tertiary`; it is not the measured expression.

### Composed frame and icon

| Property   | Compact                                        | Recipient                                    |
| ---------- | ---------------------------------------------- | -------------------------------------------- |
| Height     | `h-7`                                          | `min-h-8`, measured 32px empty               |
| Padding    | `px-1.5 py-[3px]`                              | `px-1 py-0.5` on outer frame; input adds 2px |
| Radius     | `rounded-md` (6px)                             | same                                         |
| Background | `bg-secondary-translucent` (`bacSecTra`)       | `bg-transparent`                             |
| Idle ring  | `shadow-input`: `0 0 0 1px var(--n-borPriTra)` | same                                         |
| Focus ring | `shadow-focus-input` (`inpBluFocRin`)          | same                                         |
| Border     | none                                           | none                                         |
| Icon       | `size-4 text-icon-secondary` (`icoSec`)        | none observed                                |

The compact icon and input occupy 16px and 198px respectively inside the 232px frame; frame padding is 6px on each side. No CSS column-gap was reported (`normal`); do not infer a Tailwind gap from that value alone.

## States

Settings follow-up measurements: profile-name and settings search retain `bg-secondary-translucent`, 6px radius and 14px/20px text in both themes. The profile field uses an outward `shadow-input` idle ring; settings search uses `shadow-input-inset` (`inset 0 0 0 1px var(--n-borPriTra)`). Both replace the idle ring with `shadow-focus-input` on keyboard focus and restore it on blur. Hover did not change these properties. The settings search icon uses `icoTer` (`text-icon-tertiary`), with a measured SVG box of 12.5×16px; the Lucide counterpart uses the library's 16px box. The filled profile field was observed without editing its value. Disabled/error states remain unmeasured.

| Part              | State                    | Measured change                                               |
| ----------------- | ------------------------ | ------------------------------------------------------------- |
| Compact frame     | idle                     | `shadow-input`                                                |
| Compact frame     | pointer hover, unfocused | Same background, geometry and shadow as idle, both themes     |
| Compact frame     | focused                  | Shadow replaced with `shadow-focus-input`; geometry unchanged |
| Recipient frame   | idle                     | Transparent background, `shadow-input`                        |
| Recipient frame   | keyboard focus-visible   | `shadow-focus-input`; native input itself has no shadow       |
| Command input     | keyboard focus-visible   | No shadow or visible border on the native input               |
| All native inputs | placeholder              | Primary text at 0.375 opacity, both themes                    |

The recipient's keyboard focus was verified with real Tab traversal and `:focus-visible`. Page-menu search autofocus was measured on open. Native inputs have a stylesheet `:focus { outline: 0px; }`; under forced colors a `:focus-visible` rule sets a 2px transparent solid outline with 2px offset. Native focus styling alone does not capture the frame's JavaScript-managed shadow.

Base UI exposes `data-disabled` and, with Field, `data-valid`, `data-invalid`, `data-dirty`, `data-touched`, `data-filled`, and `data-focused`. No visual treatment is specified for unobserved states; do not manufacture fixtures by setting DOM attributes.

## Motion

The probe recorded an empty animation timeline while Tab moved out of and back into the page-menu search. Its frame's computed transition was `all` (zero-duration shorthand). The measured compact focus-ring replacement is an instant snap; no Motion animation is needed for it.

Command and recipient focus-transition durations, hover transition durations, and popup open/close motion were not separately timed. Popup motion belongs to Command, DropdownMenu, or Popover, rather than Input. No reduced-motion-specific rule appeared in the inspected input/frame rules.

## Interaction

| Part            | Measured hit area                                    | Cursor | Focus                                  |
| --------------- | ---------------------------------------------------- | ------ | -------------------------------------- |
| Compact input   | 198×20, same as native input box                     | text   | Autofocus on menu open; Tab moves away |
| Recipient input | 326×24 rounded to integers, same as native input box | text   | Reachable through Tab traversal        |
| Command input   | 866×24, same as native input box                     | text   | Autofocus on ⌘K                        |

The frame's text cursor does not establish its entire clickable focus area; only native input hit areas were probed. Inputs must receive an accessible name via a label or Field composition, per Base UI's usage guidelines. Notion's search inputs carry combobox semantics; those semantics and result navigation belong to their search composition rather than the generic Input.

Do not submit the recipient field. Value editing, selection, clearing, filtering, validation, and focus return after dismissing each host surface were not tested. Placement/collision behavior belongs to the host surface.

## Responsive

Live viewport dimensions were verified after each resize, with height held at 697px:

| Width | Compact frame | Native input | Change |
| ----- | ------------- | ------------ | ------ |
| 1440  | 232×28        | 198×20       | None   |
| 1024  | 232×28        | 198×20       | None   |
| 768   | 232×28        | 198×20       | None   |
| 600   | 232×28        | 198×20       | None   |
| 400   | 232×28        | 198×20       | None   |

No media/container or coarse-pointer rule appeared in the inspected compact input/frame rules, except the forced-colors focus rule. Recipient and command were measured at baseline only; responsive behavior and real touch behavior remain unmeasured. Original 1470×697 viewport restored after testing.

## Dark mode

Geometry is unchanged. Primary text and placeholder follow `texPri`; compact icon follows `icoSec`; compact background follows `bacSecTra`. Idle shadow uses `borPriTra` (light `rgba(28,19,1,0.11)`, dark `rgba(255,255,235,0.1)`); focused shadow uses `inpBluFocRin` in both themes. No additional hardcoded dark override is needed for measured properties.

## Gaps

- **Missing fixture:** the sandbox currently has no database/filter surface. Filter-value inputs from SOURCES.md could not be measured; add that fixture before claiming complete Input coverage.
- **Unobserved states:** disabled, read-only, invalid/error, valid, dirty, and touched; active press. Filled appearance is now covered by the existing profile-name value in Settings; no destructive or persistent changes were made to obtain it.
- **Partial state coverage:** command has focused screenshots only; recipient has idle and keyboard focus screenshots, but no separate hover comparison. Compact has idle, hover and focused screenshots in both themes.
- **Untokenized:** placeholder opacity 0.375 is a measured scalar. Idle frame shadow is flagged UNTOKENIZED by the probe, but its inline variable identifies `borPriTra`; use the existing `shadow-input` derived utility rather than hardcoding the computed color.
- **Unmapped tokens:** none among the measured properties; `shadow-input` and `shadow-focus-input` already exist. The existing DropdownMenuSearch icon/placeholder utilities differ from these fresh measurements; reconciling implementation is outside this spec task.
- **Not observable in the initial pass:** standalone labeled form control (subsequently measured in Settings as documented above). Error message composition, filled recipient chips, command/recipient/settings responsive layouts, touch behavior, and untimed transitions remain unmeasured. Textarea seen in Share is outside Input scope.
- **Command dismissal:** Escape did not fully restore pointer access to the page header in this session; reloading restored it. Do not infer normal focus-return behavior from that incident.

## Screenshots

`input/command-focused-{light,dark}.png`; `input/menu-{idle,hover,focused}-{light,dark}.png`; `input/share-{idle,keyboard}-{light,dark}.png`; `input/menu-width-{1440,1024,768,600,400}.png`. Each capture uses CSS-pixel scale. Width captures show compact search in light mode.
