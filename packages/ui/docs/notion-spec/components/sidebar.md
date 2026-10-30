# Sidebar spec

Captured 2026-10-29 from the signed-in Notion desktop sidebar beside **nui sandbox page**: Home navigation, Private page tree, empty Upcoming events / Shared sections, and workspace footer. Original viewport 1470×693. Measurements and timelines: [raw evidence](sidebar/measurements.json).

Base UI: no `@base-ui/react/sidebar` module or Sidebar documentation exists in the installed package. Compose a semantic `nav` shell, links/buttons, and `@base-ui/react/collapsible` for sections. Header tabs are covered by [Tabs](tabs.md); their content panels are slots, not a second Sidebar implementation. This spec describes the current sidebar, which differs from older Notion layouts with the workspace switcher at the top.

## Variants

| Variant         | Content                                                       | Measured size                                                  | Intent                         | Where in Notion                                 |
| --------------- | ------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ | ----------------------------------------------- |
| `expanded`      | Header, search trigger, tabs, scrollable groups, footer       | 270×693                                                        | Navigation                     | Sandbox page                                    |
| `collapsed`     | Hidden panel; topbar opener remains                           | Layout width 0; opener 24×24                                   | Navigation                     | After closing sidebar                           |
| `page`          | Page icon or emoji, truncated label, hover disclosure/actions | 254×30                                                         | Neutral; current page selected | Private tree                                    |
| `navigation`    | Icon, label, conditional shortcut button                      | Wrapper 254×30; main button 246×30 idle, 219×30 on hover/focus | Neutral                        | Library, Connections, External agents, New chat |
| `section`       | Label, conditional chevron and actions                        | 254×30                                                         | Neutral                        | Private, Shared, Upcoming events                |
| `muted-action`  | Icon and label                                                | 254×30                                                         | Secondary                      | Customize sidebar; Start collaborating          |
| `empty`         | Icon and truncated explanatory text                           | Label 208×21                                                   | Informational                  | No upcoming events                              |
| `search`        | Label and shortcut badge                                      | 246×32                                                         | Neutral                        | Search or ask                                   |
| `icon-action`   | Icon only                                                     | 28×28; SVG 20×20                                               | Neutral, or blue updates icon  | Top action strip / footer                       |
| `inline-action` | Icon only                                                     | 20×20; SVG 16×16                                               | Neutral                        | Row and section menus/add controls              |
| `workspace`     | Emoji, name, chevron                                          | Trigger 164×28, content 30 high                                | Neutral                        | Footer                                          |

No destructive, disabled, loading, or nested-page variant was visible. A floating/hover sidebar was not successfully opened; hidden DOM is not evidence of a working visible variant.

## Anatomy

| nui / Base UI part                     | Notion element                                                   | Notes                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Sidebar` (composition)                | `nav.notion-sidebar-container[aria-label="Seitenleiste"]`        | Reserves layout width; background and trailing divider                                 |
| `SidebarPanel` (composition)           | `.notion-sidebar`                                                | Animates opacity/transform separately from layout width                                |
| `Header`                               | First 270×126 content region                                     | 44-high action strip, search, tabs                                                     |
| `Content`                              | `nav [role="tabpanel"]`, descendant `.notion-scroller`           | Flexible height, `min-height:0`, vertical scrolling                                    |
| `Group` / `Collapsible.Root`           | `.notion-outliner-private-header-container`                      | Private example contains header plus tree                                              |
| `GroupTrigger` / `Collapsible.Trigger` | `.notion-outliner-private-header`                                | `aria-expanded`, `aria-controls`; maps to `data-panel-open`                            |
| `GroupContent` / `Collapsible.Panel`   | Controlled `div[role="tree"]`                                    | 254×92 for three page rows; removed on close                                           |
| `Item`                                 | `a[role="treeitem"]` and `[data-inp-target="sidebar-page-item"]` | Outer interaction layer; inner selected layer                                          |
| `ItemLabel`                            | Element referenced by the tree item's `aria-labelledby`          | Actual label is regular weight, despite medium-weight ancestors                        |
| `ItemAction`                           | Nested `[role="button"]`                                         | Keep separate activation targets in nui; do not blindly copy nested interactive markup |
| `Footer`                               | Bottom 270×44 region                                             | Workspace switcher and three icon controls                                             |
| `ResizeHandle`                         | `nav [role="separator"]`                                         | Vertical separator with keyboard instruction and numeric ARIA attributes               |
| `Trigger`                              | `[aria-label="Seitenleiste schließen"]` / `.notion-open-sidebar` | Close inside panel; open in topbar                                                     |

Base UI Collapsible exposes `data-open`, `data-closed`, `data-starting-style`, and `data-ending-style` on Root/Panel. Those attributes control nui state; they are not literal Notion attributes. No standalone Base UI Sidebar state contract exists.

## Parts

### Shell, header, content, footer

| Property                    | Value                                                     | Notion source                                                           |
| --------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Expanded shell              | `w-[270px] h-full shrink-0`                               | 270×693 in this workspace; user-resizable, not proven universal default |
| Background                  | `bg-secondary`                                            | `bacSec`; **not** `bg-sidebar` / `sidSecBac`                            |
| Divider                     | Inset trailing 1px line using `border-secondary` token    | `inset calc(var(--direction, 1) * -1px) 0 0 0 var(--c-borSec)`          |
| Radius                      | 0                                                         | Docked panel                                                            |
| Header action strip         | `h-11 px-3 gap-1`                                         | 44 high, horizontal padding 12, gap 4                                   |
| Header total                | 126px high                                                | Includes search and tab region                                          |
| Content                     | `flex-1 min-h-0 overflow-x-hidden overflow-y-auto pt-1.5` | 270×523, padding-top 6 at baseline                                      |
| Content inner               | `px-2 gap-3 min-h-full flex flex-col`                     | 270×517, padding-inline 8, gap 12                                       |
| Navigation rows / page rows | `gap-px`                                                  | Navigation group 254×123; three-page tree 254×92                        |
| Section stack               | `gap-1`                                                   | Section wrapper gap 4; surrounding group spacing separately 12          |
| Footer                      | `h-11 shrink-0`                                           | y=649, 44 high at viewport height 693                                   |
| Customize wrapper           | `pb-2 gap-px`                                             | 254×38 around 30-high action                                            |

The footer remains outside the scroll region. The measured content did not overflow vertically; scrollbar thumb behavior needs a longer fixture.

### Page item

| Property          | Value                                              | Notion source                                               |
| ----------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Box               | `h-[30px] w-full rounded-md`                       | 254×30 with outer shell gutters 8                           |
| Inner padding     | `px-2 py-[5px]`                                    | 5px vertical, 8px horizontal; min-height 27                 |
| Label             | `text-sm leading-[21px] font-normal truncate`      | 14/21, 400; medium 500 on ancestors is not the label weight |
| Idle label        | `text-accent`                                      | `texAccPri`                                                 |
| Current label     | `text-primary`                                     | `texPri`                                                    |
| Icon slot         | `w-[22px] h-[18px] mr-2 shrink-0`                  | Centered, margin-inline-end 8                               |
| Page SVG          | `size-[18px]`                                      | `fill:var(--c-sidSecCol)`; missing token in nui, see Gaps   |
| Disclosure target | `size-5 rounded`                                   | 20×20, replaces icon visually on hover                      |
| Disclosure SVG    | `size-3 text-icon-tertiary`                        | 12×12, closed rotate −90deg                                 |
| Trailing actions  | `size-5 rounded`, SVG `size-4 text-icon-secondary` | 20×20 / 16×16, revealed on hover                            |

The current generator maps `texAccPri` to `text-accent` and `bluIcoAccPri` to `text-icon-blue-accent`.

### Navigation item, group header, secondary action

| Part                 | Value                                                       | Notion source                                               |
| -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Navigation wrapper   | `h-[30px] w-full rounded-md pr-2`                           | 254 wide, trailing padding 8; hover background belongs here |
| Navigation content   | `px-2 py-1 text-sm leading-[21px] font-normal`              | Main button 246 wide idle, 219 when shortcut appears        |
| Navigation icon      | `size-[22px] text-icon-secondary mr-2`                      | Library SVG itself 22×22                                    |
| Shortcut target      | `size-5 rounded`                                            | 20×20; appears on hover and keyboard traversal              |
| Header               | `h-[30px] px-2 gap-1 rounded-md`                            | 254×30                                                      |
| Header label         | `text-xs leading-4 font-medium text-tertiary`               | 12/16, 500                                                  |
| Header hover label   | `text-accent`                                               | Changes together with chevron/actions appearing             |
| Header chevron       | `size-3 text-icon-tertiary` when visible                    | Idle is clipped 1×1, opacity 0; hover is 12×12              |
| Header action group  | `gap-0.5 ml-auto`                                           | Gap 2; actions 20×20                                        |
| Customize label/icon | `text-tertiary`, icon `size-[22px] text-icon-tertiary`      | Label 14/21, 400                                            |
| Shared empty action  | `sidSecCol`, content `px-2 py-1 text-sm leading-[21px]`     | Start collaborating; no value was changed                   |
| Empty event label    | `text-sm leading-[21px] font-normal text-tertiary truncate` | 208×21                                                      |

### Search and footer controls

| Part                       | Value                                                          | Notion source                                   |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| Search trigger             | `h-8 rounded-lg border border-primary-translucent pl-2 pr-1.5` | 246×32, 1px `borPriTra`, radius 8               |
| Search text                | `text-sm leading-[16.8px] font-normal text-tertiary`           | Text truncates; shortcut occupies trailing slot |
| Header/footer icon buttons | `size-7 rounded-md`, SVG `size-5`                              | 28×28 and 20×20                                 |
| Ordinary icon              | `text-icon-secondary`                                          | `icoSec`                                        |
| Updates icon               | `text-icon-blue-accent`                                        | `bluIcoAccPri`                                  |
| Workspace trigger          | `h-7 rounded-md flex-1 min-w-0`                                | 164×28 in measured footer                       |
| Workspace content          | `h-[30px] px-2 py-1`, icon slot `size-[22px] mr-2`             | Overflows trigger vertically by 1px each side   |
| Workspace name             | `text-sm leading-5 font-medium truncate`                       | 14/20, 500, `texAccPri` inherited               |
| Workspace chevron          | `size-3.5 text-icon-secondary`                                 | 14×14                                           |
| Resize handle              | `w-3 h-full cursor-col-resize`                                 | 12×693 on a 1px-wide trailing-edge parent       |

## States

| Part                             | State                         | Change                                                                                | Notion source                                                                   |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Page                             | `aria-current="page"`         | Inner `bg-interactive-translucent`, label `text-primary`                              | Selected sandbox page                                                           |
| Page                             | `:hover`                      | Outer `bg-interactive-translucent`; disclosure and trailing controls appear instantly | Pointer measurement in both themes                                              |
| Selected page                    | `:hover`                      | Inner selected fill remains; outer hover fill is added underneath                     | Two separate measured `bacIntTra` layers; do not substitute a guessed 1.5× fill |
| Page / header                    | `:focus-visible`              | `shadow-focus-button` and `bg-interactive-translucent`                                | Actual Tab focus, `butBluFocRin`                                                |
| Header                           | `:hover` / focus              | Label changes `texTer` → `texAccPri`; chevron and action buttons become visible       | Computed labels, actual focus                                                   |
| Header                           | `data-panel-open`             | Chevron 0deg; closed −90deg; content mounted/unmounted                                | `aria-expanded` observed both ways                                              |
| Navigation wrapper               | Hover / focus-within          | `bg-interactive-translucent`; shortcut appears, main button shrinks to 219px          | Wrapper measurement, keyboard traversal                                         |
| Navigation main button           | `:focus-visible`              | `shadow-focus-button`; main button's own background stays transparent                 | Focused Library / Connections                                                   |
| Customize / Shared action        | `:focus-visible`              | `bg-sidebar-item-selected`, `shadow-focus-button`                                     | Inline `sidIteSelBac`                                                           |
| Search / workspace / icon action | Hover                         | `bg-interactive-translucent`                                                          | CSS and pointer measurement                                                     |
| Search / workspace / icon action | `:focus-visible`              | `shadow-focus-button`, interaction fill                                               | Real keyboard focus; help/more also change foreground to `texPri`               |
| Resize handle                    | `:focus-visible`              | No shadow on the separator itself                                                     | Real Tab focus; surrounding edge decoration not fully characterized             |
| Any part                         | Disabled / busy / destructive | Not observed                                                                          | No applicable fixture                                                           |

Pressed expressions from `rules()` (preserve the role of the outer layer):

```css
/* Page, section, ordinary icon actions: default hover 1×; pressed 2×. */
:hover {
  background: rgb(
    from bacIntTra r g b /
    calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 0) * 1))
  );
}
:active {
  background: rgb(
    from bacIntTra r g b /
    calc(alpha * (1 + 0.5 * var(--btn-adj-mult, 1) * 2))
  );
}
/* Search pressed: 1.5×. */
:active {
  background: rgb(from bacIntTra r g b / calc(alpha * (1 + 0.5)));
}
```

The generator already provides `bg-interactive-translucent-150` and `bg-interactive-translucent-200`. These are stylesheet-derived pressed states, not screenshots of a held pointer press. Navigation wrapper state is driven by JavaScript; no equivalent pressed rule was found for its main button.

## Motion

| Transition                 | Element                                   | Motion values / behavior                                        | Duration | Delay | Ease                | Origin                 |
| -------------------------- | ----------------------------------------- | --------------------------------------------------------------- | -------- | ----- | ------------------- | ---------------------- |
| Sidebar close/open         | Layout shell                              | `width:270 ↔ 0`                                                 | 0.2s     | 0     | `[0.25,0.1,0.25,1]` | Layout                 |
| Sidebar close/open         | Panel                                     | `{opacity:1,x:0,y:0} ↔ {opacity:0,x:-250,y:59}` in this capture | 0.2s     | 0     | `[0.25,0.1,0.25,1]` | Translation, not scale |
| Section close/open         | Group content                             | Snap remove/mount; three-page content 92px                      | 0        | 0     | —                   | —                      |
| Section chevron            | SVG                                       | Snap `rotate:0 ↔ -90`                                           | 0        | 0     | —                   | —                      |
| Page/header hover          | Background, icon/action visibility        | Snap                                                            | 0        | 0     | —                   | —                      |
| Navigation shortcut reveal | Main-button width and shortcut visibility | Snap 246 → 219px                                                | 0        | 0     | —                   | —                      |
| Header/footer icon hover   | Background                                | Transparent ↔ interaction fill                                  | 0.1s     | 0     | `[0.42,0,0.58,1]`   | —                      |
| Search / workspace hover   | Background                                | Transparent ↔ interaction fill                                  | 0.02s    | 0     | `[0.42,0,1,1]`      | —                      |
| Shared empty action        | Background                                | Declared CSS transition                                         | 0.15s    | 0     | `[0.25,0.1,0.25,1]` | —                      |
| Page disclosure            | SVG transform                             | Declared transition; nested expansion untested                  | 0.2s     | 0     | `[0,0,0.58,1]`      | —                      |

Closed panel computed transform is `matrix(1,0,0,1,-250,59)` with direction 1. The animation recorder reported doubled translated endpoints (`-500,118`) while the settled computed style and inline declarations agree on `-250,59`; use the latter and retain this discrepancy as a limitation. These offsets belong to the measured hidden desktop shell, not a guessed mobile drawer. The main pane simultaneously changes width from 1200 to 1470 at the baseline viewport.

Timelines include unrelated tooltip fades and tool latency; neither is treated as a sidebar hover delay. No sidebar-specific `prefers-reduced-motion` alternatives were returned by `rules()`. For header tab animation, see [Tabs](tabs.md).

## Interaction

| Part                        | Hit area                                   | Cursor        | Focus-visible                                                      |
| --------------------------- | ------------------------------------------ | ------------- | ------------------------------------------------------------------ |
| Page row / section          | 254×30                                     | pointer       | `shadow-focus-button`                                              |
| Navigation main button      | 246×30 idle; 219×30 with shortcut          | pointer       | `shadow-focus-button`                                              |
| Navigation wrapper          | 254×30                                     | grab on hover | Focus belongs to children                                          |
| Shortcut button             | 20×20                                      | pointer       | `shadow-focus-button`                                              |
| Search                      | 246×32                                     | pointer       | `shadow-focus-button`                                              |
| Workspace                   | Visual 164×28; DOM hit 164×30, offset y=−1 | pointer       | `shadow-focus-button`                                              |
| Close                       | 28×28                                      | pointer       | Shared button ring contract; dedicated close focus capture missing |
| Open                        | 24×24                                      | pointer       | Dedicated opener focus capture missing                             |
| Resize                      | 12×693                                     | col-resize    | Separator shadow none; `:focus-visible` true                       |
| Inline page/section actions | Visual 20×20                               | pointer       | Individual action focus coverage incomplete                        |

Hit tests measure DOM coverage, not every event handler's semantic activation boundary. Sections toggle on click and keep focus on the header. Tab then reaches the first page; Shift+Tab returns to the header. Other rows and header tabs are separate Tab stops. Shortcut buttons enter keyboard traversal alongside their navigation actions. No focus trap was observed in the docked sidebar.

Closing the full sidebar moved focus to the document; reopening by mouse did not establish reliable opener-to-panel focus restoration. Retain sensible keyboard semantics in nui rather than copying focus loss. No workspace settings, page titles, page ordering, or menu selections were changed.

Placement is a left layout column, not an anchored popup. The floating panel never became visible after hovering the opener or left edge, so its collision behavior and hover delay remain unknown. Resize semantics are advertised by the separator's ARIA label (left/right arrows); width limits and increments were not exercised because they can persist workspace UI preferences.

## Responsive

Height was held at 693px. All measured sidebar parts, including header, search, tabs, page rows, sections, footer, and resize target, retained their baseline boxes at every width.

| Viewport width | Sidebar | Main content width | Change                                                    |
| -------------- | ------- | ------------------ | --------------------------------------------------------- |
| 1440           | 270×693 | 1170               | Baseline                                                  |
| 1024           | 270×693 | 754                | No sidebar change                                         |
| 768            | 270×693 | 498                | No sidebar change                                         |
| 600            | 270×693 | 330                | No sidebar change                                         |
| 400            | 270×693 | 130                | No automatic collapse; desktop content is cramped/clipped |

This is desktop Chromium with an already-open sidebar; it does not establish mobile-user-agent behavior. Content scrolling computes `overflow:hidden auto`; clientHeight and scrollHeight both 523 in the fixture. No `(pointer:coarse)` or width/container-query override was returned for the measured shell, rows, section, search, or separator. Forced-colors focus rules use a 2px transparent outline with 2px offset.

## Dark mode

Geometry and state timing are unchanged. Semantic tokens handle shell, labels, interaction backgrounds, focus ring, and divider colors. Divider is `borSec`: light `#f0efed`, dark `#2c2c2b`; its inset shape is unchanged. Page icon `sidSecCol` resolves to light `#91918e`, dark `#9b9b9b`.

Header tab icons use JavaScript-selected inline mask colors; a local theme class swap does not necessarily recompute them. Their native dark appearance remains the [Tabs spec](tabs.md) gap. Emoji artwork is platform-rendered, not a text color token.

## Gaps

- **Untokenized:** shell inset shadow is reported as untokenized because it is a composite declaration, but its color is explicitly `borSec`; use that token. No new hardcoded shadow color is needed.
- **Unmapped tokens:** live `sidSecCol` is absent from the checked nui token output/map. Add the measured light/dark values and a deliberate icon/text mapping before implementing page icons and the Shared action. Do not silently replace it with `icoSec`.
- **Not observable:** visible floating sidebar, its delay/collision behavior, mobile layouts, disabled/destructive/loading rows, nested-page indentation and keyboard tree expansion, resize bounds/steps, and overflowing sidebar scrollbars.
- **Coverage limits:** individual inline-action focus states, direct opener/close keyboard focus, and every footer action's dark focus screenshot were not captured. Shared button CSS is known, but those cells are not claimed as observed. Pressed states come from CSS, not held-button images. Secondary actions were surveyed without opening their potentially mutating flows.
- **Motion discrepancy:** recorder transform endpoints doubled the settled translation; settled matrix and inline values are retained above. No precise hover-delay inference is made from tool-spanning timestamps.
- **Accessibility:** Notion nests actions inside clickable rows and loses focus when the entire sidebar closes. Use proper independent controls and intentional focus restoration in nui.
- **Fixtures:** no new fixture was requested; existing sandbox/private navigation was sufficient for the core spec. A page with children and a longer sidebar would be needed to fill the remaining tree/scroll gaps.

## Screenshots

| Capture                | Light                                       | Dark                                      |
| ---------------------- | ------------------------------------------- | ----------------------------------------- |
| Expanded idle          | [Light](sidebar/expanded-idle-light.png)    | [Dark](sidebar/expanded-idle-dark.png)    |
| Page hover             | [Light](sidebar/page-hover-light.png)       | [Dark](sidebar/page-hover-dark.png)       |
| Selected page hover    | [Light](sidebar/selected-hover-light.png)   | [Dark](sidebar/selected-hover-dark.png)   |
| Page keyboard focus    | [Light](sidebar/page-focus-light.png)       | [Dark](sidebar/page-focus-dark.png)       |
| Section hover          | [Light](sidebar/section-hover-light.png)    | [Dark](sidebar/section-hover-dark.png)    |
| Section keyboard focus | [Light](sidebar/section-focus-light.png)    | [Dark](sidebar/section-focus-dark.png)    |
| Section closed         | [Light](sidebar/section-closed-light.png)   | [Dark](sidebar/section-closed-dark.png)   |
| Navigation hover       | [Light](sidebar/navigation-hover-light.png) | [Dark](sidebar/navigation-hover-dark.png) |
| Search keyboard focus  | [Light](sidebar/search-focus-light.png)     | [Dark](sidebar/search-focus-dark.png)     |
| Workspace hover        | [Light](sidebar/footer-hover-light.png)     | [Dark](sidebar/footer-hover-dark.png)     |
| Collapsed              | [Light](sidebar/collapsed-light.png)        | [Dark](sidebar/collapsed-dark.png)        |

Responsive: [1440](sidebar/width-1440.png), [1024](sidebar/width-1024.png), [768](sidebar/width-768.png), [600](sidebar/width-600.png), [400](sidebar/width-400.png).

[Opener hover without a visible peek](sidebar/opener-hover-no-peek-light.png) records an unsuccessful observation, not a floating-sidebar variant. Raw measurements contain initial failed selectors and the corrected later measurements.
