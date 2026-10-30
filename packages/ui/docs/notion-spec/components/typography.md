# Typography spec

Captured 2026-10-30 from the Notion page "nui sandbox typography" (page title, headings H1–H4, paragraph with inline marks, quote, callouts, code block, bulleted/numbered lists, to-dos, toggle) and the sidebar for interface text. Base UI: none; Typography is a set of plain elements. The toggle's disclosure is built with `@base-ui/react/collapsible`, so only its text styles are covered here.

Notion has **no typography tokens**: `raw-tokens.txt` holds colors and shadows only. Sizes, line heights and weights below are measured px values, translated to Tailwind's scale where they fit. Everything renders in `font-sans` (Notion's stack, already in `globals.css`) with `letter-spacing: normal`.

## Variants

| Variant         | Element in Notion                 | Size / line-height | Weight | Where in Notion    |
| --------------- | --------------------------------- | ------------------ | ------ | ------------------ |
| `title`         | page title, `contenteditable` div | 40/48              | 700    | top of every page  |
| `h1`            | `h2` (header block)               | 30/39              | 600    | Heading 1 block    |
| `h2`            | `h3` (sub_header block)           | 24/31.2            | 600    | Heading 2 block    |
| `h3`            | `h4` (sub_sub_header block)       | 20/26              | 600    | Heading 3 block    |
| `h4`            | `h5` (header_4 block)             | 18/23.4            | 600    | Heading 4 block    |
| `p`             | text block leaf                   | 16/24              | 400    | paragraph          |
| `blockquote`    | quote block                       | 16/24              | 400    | quote              |
| `callout`       | callout block, icon + text        | 16/24              | 400    | callout            |
| `ul` / `ol`     | bulleted / numbered list rows     | 16/24              | 400    | lists              |
| `todo`          | to-do row (checkbox + text)       | 16/24              | 400    | to-do              |
| `pre`           | code block                        | 13.6/20.4, mono    | 400    | code block         |
| inline `strong` | `span` `font-weight:600`          | inherits           | 600    | bold mark          |
| inline `em`     | `span` `font-style:italic`        | inherits           | —      | italic mark        |
| inline `u`      | `span` underline                  | inherits           | —      | underline mark     |
| inline `s`      | `span` `line-through`             | inherits           | —      | strikethrough mark |
| inline `code`   | `span`, mono                      | 85% (13.6px)       | 400    | inline code mark   |
| inline `a`      | `a` > `span`                      | inherits           | —      | link               |
| placeholder     | empty focused block, `::after`    | inherits           | —      | empty text block   |

All headings share a 1.3 line-height ratio. The title is 1.2. Body text and code are 1.5.

Interface text, measured in the sidebar (reference only; each component spec owns its text):

| Use                     | Size / line-height | Weight |
| ----------------------- | ------------------ | ------ |
| sidebar rows            | 14/21              | 400    |
| sidebar tabs, user name | 14/16.8, 14/20     | 500    |
| search placeholder      | 14/16.8            | 400    |
| section labels          | 12/16              | 500    |
| ⌘K shortcut hint        | 11/14.3            | 500    |

## Anatomy

| Part          | Notion element                                                         | Notes                                                                                          |
| ------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Page column   | `.notion-page-content`, 720px wide, `padding-top: 8px`                 | blocks fill it; no margins between blocks                                                      |
| Block wrapper | `div` inside each block carrying the vertical rhythm as padding        | `padding-inline: 6px` on every text block                                                      |
| Leaf          | the `contenteditable` element holding text                             | `padding: 2px` (lists: `2px 0 2px 6px`), `white-space: break-spaces`, `word-break: break-word` |
| Heading level | Notion renders H1→`h2`, H2→`h3`, H3→`h4`, H4→`h5`                      | the page title takes the top level; nui should use `h1`–`h4` per level                         |
| Marker        | list ::before (`•` / `1.`), 24px slot                                  | `padding-left: 2px` on the row before the slot                                                 |
| Quote rule    | `border-inline-start: 3px solid currentColor` on the quote's inner div |                                                                                                |
| Callout icon  | emoji in a 24px slot                                                   |                                                                                                |

Fresh `chain()`/tree walks confirmed each wrapper. Block heights equal wrapper padding + leaf (e.g. H1 79 = 30 + 2 + 39 + 2 + 6).

## Parts

### Headings and title

| Property      | `title`                               | `h1`                                      | `h2`                                   | `h3`                                  | `h4`                                  | Notion source                                      |
| ------------- | ------------------------------------- | ----------------------------------------- | -------------------------------------- | ------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| Font          | `text-[40px] leading-[1.2] font-bold` | `text-[30px] leading-[1.3] font-semibold` | `text-2xl leading-[1.3] font-semibold` | `text-xl leading-[1.3] font-semibold` | `text-lg leading-[1.3] font-semibold` | 40/48 700; 30/39; 24/31.2; 20/26; 18/23.4, all 600 |
| Block padding | —                                     | `pt-7.5 pb-1.5 px-1.5`                    | `pt-6.5 pb-1.5 px-1.5`                 | `pt-5.5 pb-1.5 px-1.5`                | `pt-4.5 pb-1.5 px-1.5`                | `30 6 6`, `26 6 6`, `22 6 6`, `18 6 6`             |
| Leaf padding  | `px-2` (0 8)                          | `p-0.5`                                   | `p-0.5`                                | `p-0.5`                               | `p-0.5`                               | measured                                           |
| Block height  | 48                                    | 79                                        | 67.2                                   | 58                                    | 51.4                                  | measured                                           |
| Color         | `text-primary`                        | `text-primary`                            | `text-primary`                         | `text-primary`                        | `text-primary`                        | `texPri`                                           |

Do not use Tailwind's `text-3xl`/`text-4xl` for `h1`/`title`: those are 30/36 and 36/40.

### Paragraph

| Property | Value                                        | Notion source                                 |
| -------- | -------------------------------------------- | --------------------------------------------- |
| Font     | `text-base` (16/24), `font-normal`           | 16/24 400                                     |
| Color    | `text-primary`                               | `texPri`                                      |
| Block    | `p-1.5` (6 on all sides)                     | wrapper padding 6                             |
| Leaf     | `p-0.5`                                      | 2                                             |
| Rhythm   | one-line paragraph = 40px block (6+2+24+2+6) | measured                                      |
| Wrapping | `whitespace-break-spaces break-words`        | `break-spaces`, `break-word`                  |
| Caret    | default (`auto` = text color)                | inline `caret-color←texPri`, same as the text |

### Inline marks

| Mark      | Value                                                                                                                                                         | Notion source                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Bold      | `font-semibold`                                                                                                                                               | `font-weight:600` (not 700)                                                   |
| Italic    | `italic`                                                                                                                                                      | `font-style:italic`                                                           |
| Underline | `underline decoration-[0.05em] underline-offset-[10%]`, decoration color inherits                                                                             | inline style                                                                  |
| Strike    | `line-through`                                                                                                                                                | `text-decoration:line-through`                                                |
| Code      | `font-mono text-[85%] leading-normal px-[0.4em] py-[0.2em] rounded bg-interactive-translucent text-red-secondary relative bottom-[0.065em]`                   | inline style; `bacIntTra`, `redTexSec`; 13.6px, 2.72/5.44px padding, radius 4 |
| Link      | inner span: `underline decoration-[0.05em] underline-offset-[10%] opacity-70`, decoration color `opaLinDecCol`; `a` keeps `text-inherit` and `cursor-pointer` | inline style                                                                  |

Link text measured 16/24 `texPri` at opacity 0.7; decoration `rgba(55,53,47,.4)` light, `rgba(255,255,255,.282)` dark.

### Quote

| Property | Value                           | Notion source                                 |
| -------- | ------------------------------- | --------------------------------------------- |
| Block    | `p-2` (8)                       | measured                                      |
| Rule     | `border-s-[3px] border-current` | `border-inline-start: 3px solid currentcolor` |
| Inner    | `px-3.5` (14)                   | measured                                      |
| Leaf     | `px-2`, no vertical padding     | `pad 0 8`                                     |
| Font     | `text-base`, `text-primary`     | 16/24 400                                     |

Text sits 25px from the rule's outer edge (3 + 14 + 8).

### Callout

| Property  | Value                                                          | Notion source                          |
| --------- | -------------------------------------------------------------- | -------------------------------------- |
| Block     | `p-2`                                                          | 8                                      |
| Box       | `p-3 rounded-[10px] border border-transparent bg-gray-primary` | pad 12, r 10, `graBacPri` (inline var) |
| Icon slot | `w-6`, emoji 21.6/21.6 in Apple Color Emoji                    | 24×32.5 slot                           |
| Text      | nested paragraph: `p-1.5` block, `p-0.5` leaf, `text-base`     | same as Paragraph                      |

A bold first line ("title") inside a callout is just a `font-semibold` mark, not a separate style.

### Code block

| Property   | Value                                           | Notion source                   |
| ---------- | ----------------------------------------------- | ------------------------------- |
| Block      | `p-2`                                           | 8                               |
| Surface    | `rounded-[10px] bg-gray-primary-translucent`    | `graBacPriTra` (inline var)     |
| Padding    | `py-9 px-5.5` (24 + 12 vertical, 22 horizontal) | outer `24 22`, inner `12 0`     |
| Font       | `font-mono text-[13.6px] leading-normal`        | 13.6/20.4, SFMono-Regular stack |
| Whitespace | `whitespace-pre`, `tab-size: 2`                 | measured                        |
| Plain text | `text-primary`                                  | `texPri`                        |

Syntax colors are Prism's, scoped per theme and untokenized:

| Prism token                          | Light     | Dark                    |
| ------------------------------------ | --------- | ----------------------- |
| comment, prolog, doctype, cdata      | `#708090` | `#998066`               |
| punctuation                          | `#999999` | inherits `text-primary` |
| property, tag, boolean, number, …    | `#990055` | `#d1949e`               |
| selector, attr-name, string, char, … | `#669900` | `#bde052`               |
| operator, entity, url, CSS string    | `#9a6e3a` | `#f5b83d`               |
| atrule, attr-value, keyword          | `#0077aa` | `#66a2cc`               |
| function, class-name                 | `#dd4a68` | `#ecec93`               |
| regex, important, variable           | `#ee9900` | `#ee9900`               |
| deleted (dark only)                  | —         | `red`                   |

### Lists and to-dos

| Property      | Value                                                               | Notion source                                                              |
| ------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Row padding   | first `pt-1.5 pb-px`, middle `py-px`, last `pt-px pb-1.5`; `px-1.5` | 6/1, 1/1, 1/6; heights 35/30/35                                            |
| Marker slot   | `w-6` after `pl-0.5`                                                | 24px slot, row padding-left 2                                              |
| Bullet        | `•` in Arial, 24/24                                                 | `::before` content, 24px                                                   |
| Number        | `1.` in `font-sans` 16/24, centered in the slot                     | `::before`, `text-align:center`                                            |
| Leaf          | `pt-0.5 pb-0.5 pl-1.5`, `text-base text-primary`                    | `2 0 2 6`                                                                  |
| To-do checked | `line-through opacity-70`, decoration `text-primary` at 50% alpha   | inline `text-decoration-color: rgb(from texPri r g b / 0.5); opacity: 0.7` |

The checkbox belongs to the Checkbox spec.

### Toggle text

The row uses the paragraph rhythm (block `p-1.5`, 40px for one line). The 24×24 trigger (`rounded`, 12.8px arrow) sits flush against the leaf (`pl-1.5` leaf padding). The bold text in the fixture is a `font-semibold` mark. The trigger's hover background and arrow rotation belong to the Collapsible spec.

### Placeholder

| Property | Value                                                               | Notion source                     |
| -------- | ------------------------------------------------------------------- | --------------------------------- |
| Text     | `attr(placeholder)` via `::after`, shown on the focused empty block | `content: attr(placeholder) / ""` |
| Color    | `text-disabled-translucent` (as `-webkit-text-fill-color`)          | `texDisTra`                       |

## States

| Part        | State                            | Change                                                         | Notion source                              |
| ----------- | -------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| Empty block | focused                          | placeholder appears in `text-disabled-translucent`             | inline `-webkit-text-fill-color←texDisTra` |
| Link        | `:hover`                         | no text change; a link preview card opens (PreviewCard)        | `rules()`: only `outline: 0`               |
| Link        | `:active`                        | none                                                           | `rules()`: only `outline: 0`               |
| To-do text  | `data-checked`                   | `line-through`, decoration `texPri` at 0.5 alpha, `opacity-70` | inline style                               |
| Any text    | `:focus-visible` (forced colors) | 2px transparent outline, 2px offset                            | global `@(forced-colors: active)` rule     |

## Motion

| Transition      | Element | initial → animate / exit | Duration | Delay | Ease | Origin |
| --------------- | ------- | ------------------------ | -------- | ----- | ---- | ------ |
| any text change | text    | snap                     | —        | —     | —    | —      |

Text and marks never animate. The link hover preview (opacity 0 → 1, 0.2s, `ease-out`) and the toggle arrow (`transform` 0.2s `ease-out`, trigger background 0.02s `ease-in`) were recorded and belong to the PreviewCard and Collapsible specs.

Reduced motion: no rules.

## Interaction

| Part | Hit area | Cursor    | Focus-visible |
| ---- | -------- | --------- | ------------- |
| Text | text box | `text`    | none          |
| Link | text box | `pointer` | none observed |

Placement, focus and keyboard behaviour do not apply.

## Responsive

| Width                     | Change                                                      |
| ------------------------- | ----------------------------------------------------------- |
| 1470                      | baseline (viewport during capture); page column 720px       |
| 1440, 1024, 768, 600, 400 | not observed; the window ignored resize requests (see Gaps) |

`rules()` returned no `@media` or `@container` rules on title, headings, paragraph or page column besides the forced-colors outline. Text sizes are fixed px with no fluid scaling. Touch: no `(pointer: coarse)` rules.

## Dark mode

Tokens cover the text colors (`texPri`, `texDisTra`, `redTexSec`, `bacIntTra`, `graBacPri`, `graBacPriTra`). Not covered by tokens:

- Prism syntax colors switch to the dark set in the table above.
- Link decoration changes from `rgba(55,53,47,.4)` to `rgba(255,255,255,.282)` through `opaLinDecCol`.
- Callout surface reads as `bacSec` in dark (same rgb as `graBacPri`'s dark value); keep `bg-gray-primary`.

## Gaps

- **Untokenized:** all Prism syntax colors (light and dark sets above). Interface and block font sizes, line heights and weights have no Notion tokens.
- **Unmapped tokens:** `opaLinDecCol` (link underline color) has no utility in `scripts/build-tokens.ts`. Checked to-do decoration is `texPri` at 0.5 alpha, a derived color with no utility.
- **Theme value:** Notion's mono stack `"SFMono-Regular", Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace` is now `--font-mono` in `globals.css`.
- **Toggle:** the panel's 32px indent comes from nested list containers (x535 for a block at x503); the toggle's own children and its open/close motion were not measured.
- **Not observable:**
  - Responsive widths: `resize_window` did not change the viewport (stayed 1470px), so 1440/1024/768/600/400 were not measured.
  - Page options left untouched: "Small text", "Full width", and the Serif/Mono page fonts.
  - Colored text and background highlights, text selection color, and mentions/equations were not in the fixtures.

## Screenshots

| Content                       | Light                                                 | Dark                                                |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Title, H1, H2, H2-as-"h3", H4 | [light](typography/headings-idle-light.png)           | [dark](typography/headings-idle-dark.png)           |
| Title, H1–H4 (real H3)        | [light](typography/headings-h3-light.png)             | [dark](typography/headings-h3-dark.png)             |
| Paragraph and inline marks    | [light](typography/paragraph-marks-idle-light.png)    | [dark](typography/paragraph-marks-idle-dark.png)    |
| Quote, callouts, code block   | [light](typography/quote-callout-code-idle-light.png) | [dark](typography/quote-callout-code-idle-dark.png) |
| Lists, to-dos, toggle         | [light](typography/lists-idle-light.png)              | [dark](typography/lists-idle-dark.png)              |
| Checked to-do                 | [light](typography/todo-checked-light.png)            | [dark](typography/todo-checked-dark.png)            |
| Empty-block placeholder       | [light](typography/headings-placeholder-light.png)    | —                                                   |
| Link hover (preview card)     | [light](typography/link-hover-light.png)              | —                                                   |
