# Label spec

Captured 2026-10-29 from Notion Settings → Meine Einstellungen (My preferences) and Konto (Account). Base UI: `Field.Label` from `@base-ui/react/field`; the installed Base UI package has no standalone Label component documentation.

This spec covers field labels, including their relationship to helper text and controls. Section headings, menu group labels, badges, and control value text are separate components. Raw probe results: [label/measurements.json](label/measurements.json). Settings were observed without changing any value.

## Variants

| Variant                  | Content                               | Size                                                          | Intent                  | Where in Notion                                                |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------- |
| `default`                | plain field name                      | 14px/20px, weight 500; Design 45.8×20                         | neutral, primary text   | preference rows; select and switch labels; account action rows |
| `default` with accessory | field name followed by separate badge | same label typography; 6px gap to accessory                   | neutral                 | Hoher Kontrast + Beta; Passkeys + Empfohlen                    |
| `compact`                | label above input                     | 12px/16px, weight 400; Preferred name 250×16 at desktop width | neutral, secondary text | Bevorzugter Name in account profile                            |

Long default labels wrap without changing typography. Labels beside disabled controls keep the default appearance; that is a state observation, not an additional visual variant. The profile's compact label is a different text style, not simply the default label placed above a control.

## Anatomy

| Base UI part                                  | Notion element                                                     | Notes                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `Field.Label`                                 | default: `div` with ID referenced by a control's `aria-labelledby` | Design control references both label ID and current-value span ID        |
| `Field.Label`                                 | compact: native `label` containing “Bevorzugter Name”              | block label before a sibling input wrapper; association limitation below |
| `Field.Root`                                  | surrounding setting row or profile field container                 | context for layout and state; not part of Label's typography             |
| `Field.Control`                               | select trigger, switch, or profile text input                      | focus ring belongs here                                                  |
| `Field.Description`                           | 13px/18px helper text beneath default label                        | separate text, normally referenced by `aria-describedby`                 |
| `Field.Item`, `Field.Error`, `Field.Validity` | no corresponding measured Label decoration                         | validation fixtures not present                                          |

Fresh screenshot coordinates and `chain()` confirmed both hierarchies. Default: label → accessory row → label/description column → setting row. Compact: native label → 250px profile field container → profile row.

Map the label to the appropriate Base UI primitive when composing a field, select, or switch. For button-like controls, the installed Field docs support `nativeLabel={false}` with a non-label render element to avoid native label hover/click forwarding. For text inputs, retain a real accessible association through `Field.Label` / `Field.Control` or explicit `htmlFor` and `id`.

## Parts

### `Field.Label`

| Property         | `default`                                                  | `compact`                                      | Notion source                                                |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Font             | `font-sans text-sm leading-5 font-medium`                  | `font-sans text-xs leading-4 font-normal`      | 14/20, 500; 12/16, 400                                       |
| Text color       | `text-primary`                                             | `text-secondary`                               | `texPri`; `texSec`, both themes                              |
| Background       | transparent                                                | transparent                                    | measured                                                     |
| Padding / radius | 0 / 0                                                      | 0 / 0                                          | measured                                                     |
| Border / shadow  | none / none                                                | none / none                                    | measured label boxes                                         |
| Cursor           | `cursor-auto`                                              | `cursor-default`                               | computed auto on row labels, default on native profile label |
| Width            | intrinsic text width, constrained by available field width | `block`, fills profile field's available width | no fixed label height or intrinsic fixed width               |
| Wrapping         | normal wrapping, 20px lines                                | normal wrapping, 16px lines                    | responsive measurements                                      |
| Transition       | none                                                       | none                                           | no label transition duration or state-specific animation     |

Do not add a fixed height, nowrap, or ellipsis to the label primitive. The 250px compact desktop box is the profile field's width, not a global Label width: it shrank to 143px and then about 69px in narrower captures.

### Label layout and neighboring parts

| Relationship                  | Value                                       | Notion source                                                                                  |
| ----------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Default label / description   | `flex flex-col items-start gap-1`           | 4px gap; Design helper line 13/18, weight 400, `text-secondary`                                |
| Label / badge                 | `flex items-center gap-1.5`                 | 6px accessory-row gap; label typography unchanged                                              |
| Compact label / input frame   | `mb-1` on block label                       | margin-bottom 4px; frame begins 4px after label                                                |
| Compact label / input element | 8px measured separation                     | 4px label margin plus input frame's 4px top padding; do not turn this into an 8px label margin |
| Default field text column     | surrounding layout can have `min-w-[200px]` | measured preference column ancestor; not a Label rule                                          |

The compact input frame is 28px high and the desktop label-plus-frame container is 48px high: 16px label + 4px gap + 28px frame. That geometry belongs to field composition. The input frame's shadow and surface are outside this Label spec.

## States

| Part          | State                                                      | Change                                              | Notion source                                                                               |
| ------------- | ---------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| default label | idle / `:hover`                                            | none                                                | real hover confirmed with `matches(':hover')`                                               |
| compact label | idle / `:hover`                                            | none                                                | confirmed real hover and hover-out in both themes                                           |
| either label  | associated control focused (`data-focused` in Base UI)     | no observed label color, geometry, or shadow change | actual Tab focus on profile input; Tab/Shift+Tab focus on Design trigger                    |
| default label | adjacent control disabled                                  | label remains `text-primary`, opacity 1             | timezone label; its control has opacity 0.4                                                 |
| compact label | prefilled field (`data-filled` in Base UI)                 | standard compact appearance                         | existing profile value; no edit made                                                        |
| either label  | `data-valid`, `data-invalid`, `data-dirty`, `data-touched` | unmeasured                                          | no validation or editing fixture exercised                                                  |
| either label  | `data-disabled` on a whole Field                           | unmeasured                                          | disabled-adjacent label is not evidence that a disabled Field root applies the same styling |

The labels themselves have `tabIndex=-1`, are not in the sequential focus order, and display no independent focus ring. The measured control ring must not be applied to the label. No hover, active, disabled, or checked styling rule specific to either label was returned by `rules()`.

The probe returned generic `:focus { outline: 0px; }` and forced-colors `:focus-visible` rules: a transparent 2px solid outline with 2px offset. Those global matches do not establish that these non-focusable labels should receive keyboard focus.

## Motion

| Transition                | Element      | initial → animate / exit   | Duration      | Delay | Ease | Origin |
| ------------------------- | ------------ | -------------------------- | ------------- | ----- | ---- | ------ |
| hover in/out              | either label | unchanged                  | no transition | —     | —    | —      |
| control gains/loses focus | either label | unchanged                  | no transition | —     | —    | —      |
| responsive text wrapping  | label        | reflow to additional lines | snap          | 0     | —    | —      |

`record()` / `stop()` around label hover, hover-out, and focus traversal captured no Label animation. Some traces include Settings navigation-tab background transitions and theme-swap effects elsewhere on the page; these are not label motion. Label computed styles declare no transition, so no Motion opacity, scale, or layout animation is warranted by this evidence.

Reduced motion: no `prefers-reduced-motion` label rule was returned. Runtime reduced-motion emulation was not tested. Labels have no open/close interaction or hover-trigger delay.

## Interaction

| Part                         | Measured hit geometry                    | Cursor  | Focus-visible                              |
| ---------------------------- | ---------------------------------------- | ------- | ------------------------------------------ |
| default Design label         | visual 45.8×20; probe samples 46×20      | auto    | none; associated control receives focus    |
| compact Preferred name label | visual and probe 250×16 at desktop width | default | none; text input receives focus            |
| timezone label               | 57.4×20                                  | auto    | none; neighboring control already disabled |

`hitArea()` reports DOM hit-testing bounds, not a clickable target or an enlarged control hit region. Icons and required marks were absent from these labels. A badge is a sibling accessory, not an icon inside the Label primitive.

The default Design control uses `aria-labelledby` for field name plus current value, and `aria-describedby` for helper text. Switch rows likewise reference their label IDs. The disabled timezone's visual label had no ID linking it to its control in this fixture.

**Native-label association gap:** the profile markup contains a real `label`, but it has no `for` attribute, wraps no control, and its sibling input has no ID, `aria-label`, or `aria-labelledby` association. Visual proximity is the measured relationship. In nui, use the Base UI association rather than reproducing that missing accessible name. Label-click behavior was not tested, since the observation workflow avoids activating controls through labels.

Focus was established through real keyboard traversal without editing the input or selecting a different Design value. Control focus did not restyle the label. Floating placement, collision handling, and focus return on close do not apply to Label itself; any popup belongs to its associated control.

## Responsive

All captures used viewport height 693px with the desktop Settings navigation visible. Both label styles were remeasured at every width. Pixel widths below describe this dialog and text fixture, not reusable viewport breakpoints.

| Width | Long default label | Compact profile label | Change                                                                                                   |
| ----- | ------------------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
| 1440  | 404.6×20           | 250×16                | single lines; baseline                                                                                   |
| 1024  | 404.6×20           | 250×16                | no label geometry or typography change                                                                   |
| 768   | 260.5×40           | 250×16                | default label wraps to two 20px lines                                                                    |
| 600   | 225×40             | 143×16                | default remains two lines; compact field shrinks                                                         |
| 400   | 200×60             | 69×32                 | default wraps to three lines; compact wraps to two 16px lines; surrounding desktop dialog clips overflow |

The long label is “Verwende die Eingabetaste, um eine neue Zeile hinzuzufügen”. Short Design stays 45.8×20 at all widths. The default label's 200px minimum available column is a parent field-layout constraint; do not impose it on every Label. The compact profile container has a declared 250px width but can shrink inside its surrounding flex row.

The 400px screenshot crop includes clipping from the desktop Settings panel and scrollbar; its 200px label box extends behind that clip. Use the raw DOM measurements to distinguish wrapping from viewport visibility. Screenshot operations scroll fields into view, so absolute vertical positions vary and are not a Label spacing contract.

Touch: no `(pointer: coarse)`, media, or container override was returned for either measured label. Mobile-user-agent and sidebar-free Settings layouts were not observed.

## Dark mode

No extra component override is needed. Default remains `text-primary`; compact and helper text remain `text-secondary`. Font sizes, weights, spacing, opacity, hover behavior, and control-focus behavior stay unchanged. Both themes were measured after awaiting the probe's local theme swap; account theme settings were left untouched.

## Gaps

- **Untokenized:** none on Label itself. The raw evidence also records a neighboring input frame's 1px shadow as untokenized; that belongs to Input, not Label.
- **Unmapped tokens:** none for the measured label text styles or helper text.
- **Not observable:** validation/error appearance, dirty/touched state, whole-field disabled styling, required/optional marks, inline icons, and labels for empty fields were not supplied by these fixtures. Disabled-adjacent behavior is documented separately.
- **Association:** profile native label and disabled timezone label lack the explicit control associations described above. Do not reproduce these markup gaps in nui.
- **Interaction:** label clicks were not exercised; no control was toggled or value edited. Label has no separate focusable or pressed fixture.
- **Responsive:** genuine mobile layouts and coarse-pointer behavior were not tested. Narrow desktop clipping and field-container widths are contextual observations, not primitive requirements.

## Screenshots

| State                                     | Light                                          | Dark                                         |
| ----------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| Default labels and helper text            | [light](label/settings-idle-light.png)         | [dark](label/settings-idle-dark.png)         |
| Default label hover                       | [light](label/row-hover-light.png)             | [dark](label/row-hover-dark.png)             |
| Default label with control keyboard focus | [light](label/row-control-focus-light.png)     | [dark](label/row-control-focus-dark.png)     |
| Label beside disabled timezone control    | [light](label/disabled-adjacent-light.png)     | [dark](label/disabled-adjacent-dark.png)     |
| Compact label idle                        | [light](label/stacked-idle-light.png)          | [dark](label/stacked-idle-dark.png)          |
| Compact label hover                       | [light](label/stacked-hover-light.png)         | [dark](label/stacked-hover-dark.png)         |
| Compact label with input keyboard focus   | [light](label/stacked-control-focus-light.png) | [dark](label/stacked-control-focus-dark.png) |

Settings layouts: [1440](label/row-width-1440.png), [1024](label/row-width-1024.png), [768](label/row-width-768.png), [600](label/row-width-600.png), [400](label/row-width-400.png).

Long-label crops: [1440](label/wrapped-width-1440.png), [1024](label/wrapped-width-1024.png), [768](label/wrapped-width-768.png), [600](label/wrapped-width-600.png), [400](label/wrapped-width-400.png). Compact state crops intentionally isolate the unchanged Label; keyboard focus on its control is verified in the raw measurements.
