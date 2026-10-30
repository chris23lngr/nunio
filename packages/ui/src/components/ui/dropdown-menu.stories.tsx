import type { Meta, StoryObj } from "@storybook/react-vite"
import { CaseSensitive, Copy, Ellipsis, Link, Plus, Trash } from "lucide-react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "./button.js"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFooter,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuList,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.js"

const meta = {
  title: "Components/DropdownMenu",
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>
export default meta

type Story = StoryObj<typeof meta>

const body = within(document.body)

export const Basic: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="icon" aria-label="Aktionen" />}
      >
        <Ellipsis className="size-[22px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <Link />
            Link kopieren
            <DropdownMenuShortcut>⌘⌥L</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy />
            Duplizieren
            <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Trash />
            In den Papierkorb verschieben
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Aktionen",
    })

    await userEvent.click(trigger)
    const menu = await body.findByRole("menu")
    // Starts at opacity 0 and fades in
    await waitFor(() =>
      expect(
        within(menu).getByRole("menuitem", { name: /Duplizieren/ }),
      ).toBeVisible(),
    )

    await userEvent.keyboard("{Escape}")
    // The Motion exit animation keeps the popup mounted until it finishes
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull())
    await expect(trigger).toHaveFocus()
  },
}

// Blue layer of the focus-button shadow (Notion butBluFocRin)
const FOCUS_RING_BLUE = "rgb(35, 131, 226)"
const TRANSPARENT = "rgba(0, 0, 0, 0)"

export const KeyboardHighlight: Story = {
  ...Basic,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Aktionen" }),
    )
    const menu = await body.findByRole("menu")
    const [first, second] = within(menu).getAllByRole("menuitem")
    if (!first || !second) throw new Error("expected two items")

    // Base UI moves focus into the popup once it opens; keys pressed before that
    // go to the trigger
    await waitFor(() => expect(menu).toHaveFocus())

    // Arrow keys: background and the focus ring
    await userEvent.keyboard("{ArrowDown}")
    await waitFor(() => expect(first).toHaveAttribute("data-highlighted"))
    await waitFor(() =>
      expect(getComputedStyle(first).boxShadow).toContain(FOCUS_RING_BLUE),
    )

    // Pointer: background only
    await userEvent.hover(second)
    await waitFor(() => expect(second).toHaveAttribute("data-highlighted"))
    await waitFor(() =>
      expect(getComputedStyle(second).backgroundColor).not.toBe(TRANSPARENT),
    )
    await expect(getComputedStyle(second).boxShadow).not.toContain(
      FOCUS_RING_BLUE,
    )
  },
}

export const Searchable: Story = {
  render: () => (
    <DropdownMenu searchable>
      <DropdownMenuTrigger
        render={<Button size="icon" aria-label="Aktionen" />}
      >
        <Ellipsis className="size-[22px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuSearch placeholder="Suchaktionen…" />
        <DropdownMenuEmpty>Keine Ergebnisse</DropdownMenuEmpty>
        <DropdownMenuList>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              <Link />
              Link kopieren
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Copy />
              Duplizieren
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CaseSensitive />
                Darstellung und Layout
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuGroup>
                  <DropdownMenuItem>Kleiner Text</DropdownMenuItem>
                  <DropdownMenuItem>Volle Breite</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuList>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Aktionen" }),
    )
    const input = await body.findByPlaceholderText("Suchaktionen…")
    await waitFor(() => expect(input).toHaveFocus())

    await userEvent.type(input, "dupl")
    await waitFor(() =>
      expect(
        body.queryByRole("menuitem", { name: /Link kopieren/ }),
      ).toBeNull(),
    )
    await expect(
      body.getByRole("menuitem", { name: /Duplizieren/ }),
    ).toBeInTheDocument()

    await userEvent.type(input, "zzz")
    await waitFor(() =>
      expect(body.getByText("Keine Ergebnisse")).toBeVisible(),
    )
  },
}

export const Submenu: Story = {
  ...Searchable,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Aktionen" }),
    )
    const trigger = await body.findByRole("menuitem", {
      name: /Darstellung und Layout/,
    })
    await userEvent.hover(trigger)
    await waitFor(() => expect(body.getAllByRole("menu")).toHaveLength(2))
    await waitFor(() =>
      expect(
        body.getByRole("menuitem", { name: "Kleiner Text" }),
      ).toBeVisible(),
    )
    await expect(trigger).toHaveAttribute("data-popup-open")
  },
}

// Values from docs/notion-spec/components/dropdown-menu.md
export const SpecStyling: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger
        render={<Button size="icon" aria-label="Aktionen" />}
      >
        <Ellipsis className="size-[22px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Seite</DropdownMenuLabel>
          <DropdownMenuItem data-testid="item">
            <Link />
            Link kopieren
            <DropdownMenuShortcut data-testid="shortcut">
              ⌘⌥L
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="sub-trigger">
              Mehr
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuItem>Importieren</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem variant="accent" data-testid="accent">
            <Plus />
            Neuer Workspace
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator data-testid="separator" />
        <DropdownMenuGroup data-testid="group">
          <DropdownMenuCheckboxItem defaultChecked data-testid="checked">
            Inhaltsverzeichnis
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem data-testid="unchecked">
            Kleiner Text
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup defaultValue="christoph">
          <DropdownMenuRadioItem value="christoph" data-testid="radio">
            Christoph
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="studium">Studium</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuFooter data-testid="footer">
          <div>Zuletzt bearbeitet</div>
          <div>Heute um 16:05</div>
        </DropdownMenuFooter>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    const dark = canvasElement.closest(".dark") !== null
    const menu = await body.findByRole("menu")
    await waitFor(() => expect(getComputedStyle(menu).opacity).toBe("1"))
    const style = (el: Element) => getComputedStyle(el)
    const byId = (id: string) => body.getByTestId(id)

    // Popup
    await expect(menu.getBoundingClientRect().width).toBe(256)
    await expect(style(menu).borderRadius).toBe("10px")
    // popBac: light #fff, dark #252525
    await expect(style(menu).backgroundColor).toBe(
      dark ? "rgb(37, 37, 37)" : "rgb(255, 255, 255)",
    )
    // shaOutLg: light 20px/24px layer, dark 1px #383836 outline layer
    await expect(style(menu).boxShadow).toContain(
      dark ? "rgb(56, 56, 54) 0px 0px 0px 1px" : "0px 20px 24px 0px",
    )

    // Rows
    const item = byId("item")
    await expect(item.getBoundingClientRect().height).toBe(28)
    await expect(style(item).paddingLeft).toBe("8px")
    await expect(style(item).columnGap).toBe("8px")
    await expect(style(item).borderRadius).toBe("6px")
    await expect(style(item).fontSize).toBe("14px")
    await expect(style(byId("group")).padding).toBe("4px")

    // Notion's icons are ~15px filled glyphs in a 20px box. A 16px Lucide icon
    // draws the same visual size; 2px margins keep the 20px slot so labels start
    // 36px into the row (8px padding + 20px icon + 8px gap)
    const icon = item.querySelector("svg")
    if (!icon) throw new Error("item has no icon")
    await expect(icon.getBoundingClientRect().width).toBe(16)
    await expect(style(icon).marginLeft).toBe("2px")
    await expect(style(icon).marginRight).toBe("2px")

    // Notion keeps the platform's default font smoothing (subpixel on macOS)
    await expect(style(item).getPropertyValue("-webkit-font-smoothing")).toBe(
      "auto",
    )

    // Separator: 1px, inset 12px from both popup edges
    const sep = byId("separator").getBoundingClientRect()
    await expect(sep.height).toBe(1)
    await expect(sep.width).toBe(232)

    // texSec label, texTer shortcut (light / dark)
    const label = body.getByText("Seite")
    await expect(style(label).fontSize).toBe("12px")
    await expect(style(label).fontWeight).toBe("500")
    await expect(style(label).color).toBe(
      dark ? "rgb(173, 169, 163)" : "rgb(125, 122, 117)",
    )
    await expect(style(byId("shortcut")).fontSize).toBe("12px")
    await expect(style(byId("shortcut")).color).toBe(
      dark ? "rgb(125, 122, 117)" : "rgb(161, 158, 153)",
    )

    // Checkbox rows end in a 30×18 switch, on or off; radio rows in a check
    await expect(byId("checked")).toHaveAttribute("data-checked")
    for (const [id, background] of [
      ["checked", "rgb(39, 131, 222)"],
      [
        "unchecked",
        dark ? "rgba(120, 129, 135, 0.3)" : "rgba(135, 131, 120, 0.3)",
      ],
    ] as const) {
      const track = byId(id).querySelector("[data-slot=switch-track]")
      if (!track) throw new Error(`${id} item has no switch`)
      await expect(track.getBoundingClientRect().width).toBe(30)
      await expect(track.getBoundingClientRect().height).toBe(18)
      await waitFor(() => expect(style(track).backgroundColor).toBe(background))
    }
    await expect(byId("radio")).toHaveAttribute("data-checked")
    await expect(byId("radio").querySelector("svg")).not.toBeNull()

    // Icon colors set on the icon win over the row's default icon color
    // icoSec chevron, texPri check (light / dark)
    const chevron = byId("sub-trigger").querySelector("svg")
    if (!chevron) throw new Error("submenu trigger has no chevron")
    await expect(style(chevron).color).toBe(
      dark ? "rgb(173, 169, 163)" : "rgb(142, 139, 134)",
    )
    const check = byId("radio").querySelector("svg")
    if (!check) throw new Error("checked radio item has no check")
    await expect(style(check).color).toBe(
      dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)",
    )

    // Accent rows: bluTexAccPri (#2783de, same in both themes) for label and icon
    const accent = byId("accent")
    await expect(style(accent).color).toBe("rgb(39, 131, 222)")
    const accentIcon = accent.querySelector("svg")
    if (!accentIcon) throw new Error("accent item has no icon")
    await expect(style(accentIcon).color).toBe("rgb(39, 131, 222)")
    await expect(accentIcon.getBoundingClientRect().width).toBe(16)

    // Footer: first line medium, all 12px
    const footer = byId("footer")
    await expect(style(footer).fontSize).toBe("12px")
    const [firstLine] = footer.children
    if (!firstLine) throw new Error("footer is empty")
    await expect(style(firstLine).fontWeight).toBe("500")

    // The trigger keeps its hover background while the menu is open
    const trigger = within(canvasElement).getByRole("button", {
      name: "Aktionen",
    })
    await expect(trigger).toHaveAttribute("data-popup-open")
    await expect(style(trigger).backgroundColor).not.toBe(TRANSPARENT)
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
