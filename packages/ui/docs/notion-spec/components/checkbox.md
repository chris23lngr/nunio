# Checkbox spec

Captured 2026-10-30 from the to-do blocks on the Notion page "nui sandbox typography" (ToDo 1 unchecked, ToDo 2 checked). Base UI: `@base-ui/react/checkbox`.

## Variants

| Variant   | Content            | Size | Intent  | Where in Notion      |
| --------- | ------------------ | ---- | ------- | -------------------- |
| unchecked | empty 1.5px frame  | 16px | neutral | to-do block "ToDo 1" |
| checked   | white tick on blue | 16px | blue    | to-do block "ToDo 2" |

One size and one style. Database checkbox cells were not available (the sandbox board has no cards with a checkbox property), and Notion's to-dos have no indeterminate state.

## Anatomy

| Base UI part | Notion element                                                         | Notes                                                                                                             |
| ------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Root`       | `div` 16×16, `position: relative`, drawing frame or fill               | an invisible native `input[type=checkbox]` (16×16, `opacity: 0`, absolute) sits on top and takes clicks and focus |
| `Indicator`  | `svg.checkmarkFillSmall` 14×14 (viewBox 16), centered with a 1px inset | rendered only while checked; absent when unchecked                                                                |
| to-do slot   | 24×28 wrapper, `padding: 2px 0`, box centered at x+4, y+6              | belongs to the to-do layout, not the checkbox                                                                     |

Checkmark path (viewBox `0 0 16 16`):
`M11.62 3.18a.876.876 0 0 1 1.5.9l-5.244 8.74a.876.876 0 0 1-1.414.12L2.966 8.86a.875.875 0 1 1 1.328-1.138L7 10.879z`

## Parts

### `Root`

| Property   | unchecked                                             | checked           | Notion source                       |
| ---------- | ----------------------------------------------------- | ----------------- | ----------------------------------- |
| Size       | `size-4` (16px)                                       | `size-4`          | inline `width/height: 16px`         |
| Radius     | `rounded-[1.5px]`                                     | `rounded-[1.5px]` | inline `border-radius: 1.5px`       |
| Border     | `border-[1.5px] border-(--n-icoPri)`                  | none              | inline `border: 1.5px solid icoPri` |
| Background | transparent                                           | `bg-blue-accent`  | inline `background: bluBacAccPri`   |
| Transition | `transition-[background-color] duration-200 ease-out` | same              | `tr background 0.2s ease-out`       |
| Cursor     | `cursor-pointer`                                      | `cursor-pointer`  | on the input                        |

The border disappears when checked, so the fill covers the full 16px.

### `Indicator`

| Property | Value                                        | Notion source                                 |
| -------- | -------------------------------------------- | --------------------------------------------- |
| Size     | `size-3.5` (14px), centered in the 16px root | svg 14×14 at +1,+1                            |
| Fill     | `fill-white` in both themes                  | path fill `rgb(255, 255, 255)` light and dark |
| Mount    | only while checked (`keepMounted` off)       | svg added on check, removed on uncheck        |

## States

| Part   | State                                                            | Change                                              | Notion source                                                                                                 |
| ------ | ---------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Root` | `:hover` (unchecked)                                             | `bg-secondary-translucent-150`                      | `rgb(from bacSecTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 1)))`; measured `bacSecTra×1.57` |
| `Root` | `:active` (unchecked)                                            | `bg-secondary-translucent-200`                      | `rgb(from bacSecTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 2)))`; recorded alpha 0.063      |
| `Root` | `data-checked`                                                   | border removed, `bg-blue-accent`, Indicator mounted | inline style                                                                                                  |
| `Root` | `data-checked` + `:hover`/`:active`                              | none: the blue fill wins                            | inline background overrides the `:hover` rule; measured `bluBacAccPri` while hovered                          |
| `Root` | `:focus-visible` (input)                                         | `shadow-focus-button` on the box                    | box-shadow `butBluFocRin`, set from JS (no stylesheet rule), both states                                      |
| `Root` | `data-disabled`, `data-readonly`, `data-indeterminate`, validity | unmeasured                                          | no fixture                                                                                                    |

Focus ring values: light `0 0 0 2px #f8f8f7, 0 0 0 4px #2383e2, 0 0 0 6px #ffffff40`; dark `0 0 0 2px #191919, 0 0 0 4px #2383e2, 0 0 0 6px #191919`. Both are the `butBluFocRin` token.

## Motion

| Transition | Element     | initial → animate / exit                                               | Duration | Delay | Ease              | Origin |
| ---------- | ----------- | ---------------------------------------------------------------------- | -------- | ----- | ----------------- | ------ |
| hover in   | `Root`      | background transparent → `secondary-translucent-150`                   | 0.2      | 0     | `[0, 0, 0.58, 1]` |        |
| hover out  | `Root`      | background → transparent                                               | 0.2      | 0     | `[0, 0, 0.58, 1]` |        |
| press      | `Root`      | background `-150` → `-200`                                             | 0.2      | 0     | `[0, 0, 0.58, 1]` |        |
| check      | `Root`      | background (pressed gray) → `blue-accent`                              | 0.2      | 0     | `[0, 0, 0.58, 1]` |        |
| check      | `Indicator` | snap: mounted at full opacity, no scale                                | —        | —     | —                 |        |
| uncheck    | `Root`      | background `blue-accent` → `secondary-translucent-150` (still hovered) | 0.2      | 0     | `[0, 0, 0.58, 1]` |        |
| uncheck    | `Indicator` | snap: removed                                                          | —        | —     | —                 |        |

Recorded with a real click (by the user) on ToDo 1, checked then unchecked; ToDo 1 is unchecked again. Hover-out interruptions shorten the transition proportionally (a 52ms reverse from a partly faded state), which CSS transitions do by default.

Reduced motion: no rules touch the checkbox.

## Interaction

| Part   | Hit area                                                                                                 | Cursor    | Focus-visible         |
| ------ | -------------------------------------------------------------------------------------------------------- | --------- | --------------------- |
| `Root` | 16×16 (the input); 18×18 when unchecked, because the input sits inside the 1.5px border and overhangs it | `pointer` | `shadow-focus-button` |

The native input has `tabIndex 0` and no `aria-label`; the to-do text is not linked to it. Keyboard focus was reached with Shift+Tab between to-dos (Tab in a Notion page indents the block). In nui, render the root over the full 16px and name it with a label.

## Responsive

| Width | Change                                                       |
| ----- | ------------------------------------------------------------ |
| 1440  | baseline: box 16×16, slot 24×28                              |
| 1024  | no change                                                    |
| 768   | no change                                                    |
| 600   | no change                                                    |
| 500   | no change (Chrome's minimum window width; 400 not reachable) |

Touch: no `(pointer: coarse)` or other media rules.

## Dark mode

None beyond tokens: the frame stays `icoPri`, the fill `bluBacAccPri`, the tick white, and the focus ring follows `butBluFocRin`'s dark value.

## Gaps

- **Untokenized:** none.
- **Unmapped tokens:** `icoPri` used as a border color has no `border-*` utility; use `border-(--n-icoPri)` until one is added.
- **Not observable:**
  - Disabled, read-only and indeterminate states (no fixtures; Notion to-dos have no indeterminate).
  - Database checkbox property cells (no fixture in the sandbox database).
  - Widths below 500px (Chrome's minimum window width).

## Screenshots

| State           | Light                                       | Dark                                      |
| --------------- | ------------------------------------------- | ----------------------------------------- |
| Idle (both)     | [light](checkbox/todo-idle-light.png)       | [dark](checkbox/todo-idle-dark.png)       |
| Unchecked hover | [light](checkbox/todo-hover-light.png)      | [dark](checkbox/todo-hover-dark.png)      |
| Unchecked focus | [light](checkbox/unchecked-focus-light.png) | [dark](checkbox/unchecked-focus-dark.png) |
| Checked focus   | [light](checkbox/checked-focus-light.png)   | [dark](checkbox/checked-focus-dark.png)   |

Widths: [1440](checkbox/width-1440.jpg), [500](checkbox/width-500.jpg).
