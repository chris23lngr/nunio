# Switch spec

Captured 2026-10-28 from the topbar "•••" page menu ("Seite sperren", off) and the Settings modal ("Meine Einstellungen": three on, four off). Base UI: `@base-ui/react/switch`.

Notion draws one switch everywhere: a 30×18 pill with a 14px white thumb. A transparent `input[role=switch]` covers it and takes the clicks; a round wrapper behind the track carries hover, pressed and the focus ring.

## Variants

| Variant   | Content       | Size  | Intent       | Where in Notion                          |
| --------- | ------------- | ----- | ------------ | ---------------------------------------- |
| `default` | track + thumb | 30×18 | blue when on | page menu "Seite sperren", Settings rows |

No size or color variants and no disabled switch were seen.

## Anatomy

| Base UI part | Notion element                                                          | Notes                                                           |
| ------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `Root`       | round wrapper `div` 30×18 holding the track and an `input[role=switch]` | the input is `opacity: 0`, absolutely positioned over the track |
| track        | `div` 26×14 content box + 2px padding = 30×18                           | not a Base UI part; the Root's own background in nui            |
| `Thumb`      | `div` 14×14                                                             | moves with `translateX`                                         |

## Parts

### `Root` (wrapper + track)

| Property | Value                              | Notion source                                            |
| -------- | ---------------------------------- | -------------------------------------------------------- |
| Size     | `h-[18px] w-[30px]`, `p-0.5` (2px) | 26×14 content box, `padding: 2px`, `content-box`         |
| Layout   | `inline-flex shrink-0`             | `display: flex; flex-shrink: 0`                          |
| Radius   | `rounded-full`                     | `44px`                                                   |
| Off      | `bg-switch` (new token, see Gaps)  | `swiButTeaBg`: light `#8783784d`, dark `#7881874d` (30%) |
| On       | `bg-blue-accent`                   | `bluBacAccPri`                                           |
| Cursor   | `cursor-pointer`                   | input `cursor: pointer`                                  |

### `Thumb`

| Property   | Value                   | Notion source      |
| ---------- | ----------------------- | ------------------ |
| Size       | `size-3.5` (14)         | 14×14              |
| Radius     | `rounded-full`          | `44px`             |
| Background | `bg-white`, both themes | literal `white`    |
| Shadow     | none                    | `sh none`          |
| Off        | `translate-x-0`         | `translateX(0px)`  |
| On         | `translate-x-3` (12px)  | `translateX(12px)` |

## States

| Part   | State            | Change                                             | Notion source                                                                      |
| ------ | ---------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Root` | `data-checked`   | track `bg-blue-accent`, thumb `translate-x-3`      | inline style                                                                       |
| `Root` | `:hover`         | wrapper behind the track `bacSecTra` at 1.5× alpha | `rgb(from bacSecTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 1)))` |
| `Root` | `:active`        | wrapper `bacSecTra` at 2× alpha                    | `rgb(from bacSecTra r g b / calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 2)))` |
| `Root` | `:focus-visible` | `shadow-focus-button` on the wrapper               | `butBluFocRin` (2px surface gap, 2px blue, 2px halo)                               |

The hover tint sits under the translucent off track, so it darkens the pill slightly; under the opaque on track it is invisible.

## Motion

| Transition | Element | initial → animate            | Duration | Delay | Ease                   | Origin |
| ---------- | ------- | ---------------------------- | -------- | ----- | ---------------------- | ------ |
| toggle     | track   | background off ↔ on          | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` |        |
| focus      | track   | box-shadow                   | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` |        |
| toggle     | `Thumb` | `x: 0` ↔ `x: 12`, background | 0.2      | 0     | `[0, 0, 0.58, 1]`      |        |

From the inline `transition` declarations (`background 200ms, box-shadow 200ms` on the track, `transform 200ms ease-out, background 200ms ease-out` on the thumb). Toggling was not recorded, since a click would change the workspace. Reduced motion: no rules.

## Interaction

| Part   | Hit area           | Cursor    | Focus-visible         |
| ------ | ------------------ | --------- | --------------------- |
| `Root` | 30×18, same as box | `pointer` | `shadow-focus-button` |

The row label is a plain `div` referenced by `aria-labelledby`; clicking the label does not toggle (cursor `auto`). In menus the whole row toggles because the row is the `CheckboxItem`.

## Responsive

| Width | Change                                        |
| ----- | --------------------------------------------- |
| all   | no `@media` or `@container` rules on any part |

Touch: `(pointer: coarse)` rules: none.

## Dark mode

None beyond tokens: the off track flips to `#7881874d`, the focus ring's gap and halo to `#191919`. The thumb stays white.

## Gaps

- **Unmapped tokens:** `swiButTeaBg` (off track) is not in `scripts/build-tokens.ts`. Map it as `--background-color-switch`. The existing `bg-switch-track` is `swiTogDesTraBg`, a different 40% gray Notion did not use on these switches.
- **Untokenized:** thumb background is literal `white`.
- **Not observable:** pressed state and the toggle animation (clicking commits a change); disabled switches (no fixture).

## Screenshots

`switch/menu-off-hover-{light,dark}.png`, `switch/settings-on-focus-{light,dark}.png`.
