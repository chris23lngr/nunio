# Popover spec

Captured 2026-10-28 from the "nui sandbox page": the topbar "Teilen" (Share) popover and the breadcrumb "Privat" (move to) popover. Base UI: `@base-ui/react/popover`.

Notion's popovers share the menu surface (`popBac`, `shaOutLg`, scale-in from the trigger) but are dialogs: `role="dialog"`, `aria-modal="true"`, with free-form content. Each surface sets its own width inline; the frame around the content is the same.

## Variants

| Variant   | Content                                                  | Width | Radius | Max height | Placement                         | Where in Notion       |
| --------- | -------------------------------------------------------- | ----- | ------ | ---------- | --------------------------------- | --------------------- |
| `default` | tabs, invite input + button, member rows, footer buttons | 456   | 12     | 90vh       | below trigger, gap 8, align end   | topbar "Teilen"       |
| move to   | search input, page tree, footer                          | 330   | 10     | 70vh       | below trigger, gap 5, align start | breadcrumb "Privat ⌄" |

The move-to surface is a searchable picker and belongs to Combobox/Command later; it is recorded here for the shared frame. The date property picker from SOURCES.md was not measured: the sandbox has no database fixture.

## Anatomy

| Base UI part  | Notion element                                              | Notes                                                      |
| ------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `Trigger`     | ghost Button ("Teilen" 72×28, "Privat" 85×24)               | `aria-expanded="true"`, `aria-haspopup="dialog"` on Teilen |
| `Backdrop`    | transparent full-viewport `div`, no background              | blocks pointer interaction with the page while open        |
| `Positioner`  | `div` carrying the transition and `transform-origin`        | `top: 100%` + `--x-top: 8px`                               |
| `Popup`       | `div[role=dialog]`, `aria-modal="true"`, `overflow: hidden` | the visible surface                                        |
| `Title`       | absent (no `aria-labelledby`)                               |                                                            |
| `Description` | absent                                                      |                                                            |
| `Close`       | absent; closes on Escape or an outside click                |                                                            |
| `Arrow`       | absent                                                      |                                                            |
| `Viewport`    | absent                                                      |                                                            |

## Parts

### `Popup`

| Property   | Value                                                 | Notion source                                 |
| ---------- | ----------------------------------------------------- | --------------------------------------------- |
| Width      | set per surface (`w-[456px]`, `w-[330px]`)            | inline `width` / `--x-width`                  |
| Min width  | `min-w-45` (180)                                      | `--x-minWidth: 180px`                         |
| Max width  | `max-w-[calc(100vw-24px)]`                            | `--x-maxWidth: calc(100vw - 24px)`            |
| Max height | `max-h-[90vh]` (`default`), 70vh on move to           | `--x-maxHeight`                               |
| Radius     | `rounded-xl` (12) `default`; `rounded-[10px]` move to | `r 12`, `r 10`                                |
| Background | `bg-popover`                                          | light `bacPri`/`popBac` `#fff`, dark `popBac` |
| Shadow     | `shadow-lg`                                           | `shaOutLg`, both themes                       |
| Text       | `text-primary`, inherits 16/24                        | `texPri`                                      |
| Overflow   | `overflow-hidden`                                     | content scrolls inside its own regions        |
| Padding    | none; content brings its own                          | `pad 0`                                       |

### `Trigger`

The Button spec applies. While open, the "Teilen" ghost button keeps its hover background (`bacIntTra`) after the pointer leaves, which nui's Button already does via `data-popup-open`.

## States

| Part      | State                                       | Change                       | Notion source             |
| --------- | ------------------------------------------- | ---------------------------- | ------------------------- |
| `Trigger` | `data-popup-open`                           | `bg-interactive-translucent` | `bacIntTra`, pointer away |
| `Popup`   | `data-starting-style` / `data-ending-style` | see Motion                   |                           |

## Motion

| Transition | Element   | initial → animate / exit                                   | Duration | Delay | Ease                   | Origin               |
| ---------- | --------- | ---------------------------------------------------------- | -------- | ----- | ---------------------- | -------------------- |
| open       | `Popup`   | `{ opacity: 0, scale: 0.96 }` → `{ opacity: 1, scale: 1 }` | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` | `--transform-origin` |
| close      | `Popup`   | exit `{ opacity: 0, scale: 0.96 }`, removed at 200ms       | 0.2      | 0     | `[0.25, 0.1, 0.25, 1]` | `--transform-origin` |
| open       | `Trigger` | background → `bacIntTra`                                   | 0.1      | 0     | ease-in-out            |                      |

Origin is the corner toward the trigger: `100% top` for "Teilen" (align end), `0% top` for "Privat" (align start). Reduced motion: no rules (the transition is set inline from JavaScript).

## Interaction

| Part       | Hit area      | Cursor    | Focus-visible    |
| ---------- | ------------- | --------- | ---------------- |
| `Trigger`  | same as box   | `pointer` | Button spec ring |
| `Backdrop` | full viewport | `auto`    | none             |

Placement: below the trigger. "Teilen" gap 8 align end; "Privat" gap 5 align start. Width is clamped to the viewport minus 12px each side.

Focus: on open, focus moves to the first input ("E-Mail oder Gruppe…", "Seite verschieben nach…"), which is Base UI's default (first tabbable). On close by Escape or outside click, focus returns to the trigger and it is `:focus-visible` after Escape. Modal: outside pointer interaction is blocked by the transparent backdrop; the first outside click only closes.

## Responsive

| Width | Change                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------- |
| 1440  | baseline                                                                                              |
| all   | no `@media` or `@container` rules on any popover part; only the `calc(100vw - 24px)` max width reacts |

Touch: `(pointer: coarse)` rules: none.

## Dark mode

None; `popBac` and `shaOutLg` flip with the theme.

## Gaps

- **Not observable:** the window would not resize (maximized), so widths below 1470 were not screenshotted; behaviour is inferred from the max-width rule and the absence of media queries. The date property picker needs a database fixture in the sandbox.
- **Unmapped tokens:** none.

## Screenshots

`popover/share-open-{light,dark}.png`, `popover/move-open-{light,dark}.png`.
