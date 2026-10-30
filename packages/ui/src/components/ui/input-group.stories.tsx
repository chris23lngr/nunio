import type { Meta, StoryObj } from "@storybook/react-vite"
import { Search, X } from "lucide-react"
import { expect, userEvent, within } from "storybook/test"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./input-group.js"

const meta = {
  title: "Components/InputGroup",
  component: InputGroup,
} satisfies Meta<typeof InputGroup>
export default meta

type Story = StoryObj<typeof meta>

const FOCUS_RING_BLUE = "rgb(35, 131, 226)"
const rect = (el: Element) => el.getBoundingClientRect()
const style = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo)

export const Basic: Story = {
  render: () => (
    <InputGroup className="w-58" data-testid="group">
      <InputGroupAddon data-testid="addon">
        <Search />
      </InputGroupAddon>
      <InputGroupInput aria-label="Suche" placeholder="Suchaktionen…" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label="Leeren">
          <X />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole("textbox", { name: "Suche" })
    const group = canvas.getByTestId("group")
    const clear = canvas.getByRole("button", { name: "Leeren" })

    // Clicking the icon addon focuses the input, like Notion's text-cursor frame
    await userEvent.click(canvas.getByTestId("addon"))
    await expect(input).toHaveFocus()
    await userEvent.type(input, "Seite")
    await expect(input).toHaveValue("Seite")

    // A button inside the group keeps its own focus and leaves the frame idle
    const focused = style(group).boxShadow
    await expect(focused).toContain(FOCUS_RING_BLUE)
    await userEvent.tab()
    await expect(clear).toHaveFocus()
    await expect(style(group).boxShadow).not.toBe(focused)
  },
}

// Values from docs/notion-spec/components/input.md
export const SpecStyling: Story = {
  render: () => (
    <div className="flex w-84 max-w-full flex-col items-start gap-6">
      {/* Page menu search ("Aktionen") */}
      <InputGroup className="w-58" data-testid="menu">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput aria-label="Menüsuche" placeholder="Suchaktionen…" />
      </InputGroup>
      {/* Settings search */}
      <InputGroup variant="inset" className="w-56" data-testid="settings">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Einstellungssuche"
          placeholder="Einstellungen durchsuchen"
        />
      </InputGroup>
      {/* Share recipients */}
      <InputGroup variant="outline" data-testid="recipient">
        <InputGroupInput
          aria-label="Empfänger"
          placeholder="E-Mail oder Gruppe, durch Kommas getrennt"
        />
      </InputGroup>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const dark = document.documentElement.classList.contains("dark")
    const canvas = within(canvasElement)
    const primary = dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)"
    const filled = dark ? "rgba(252, 252, 252, 0.03)" : "rgba(66, 35, 3, 0.03)"
    const ring = dark ? "rgba(255, 255, 235, 0.1)" : "rgba(28, 19, 1, 0.11)"

    // Menu search: 232×28 bacSecTra frame, 3px 6px padding, 16px icoSec icon,
    // 198×20 input
    const menu = canvas.getByTestId("menu")
    const menuInput = canvas.getByRole("textbox", { name: "Menüsuche" })
    await expect(rect(menu).height).toBe(28)
    await expect(style(menu).padding).toBe("3px 6px")
    await expect(style(menu).borderRadius).toBe("6px")
    await expect(style(menu).backgroundColor).toBe(filled)
    await expect(style(menu).boxShadow).toContain(ring)
    await expect(style(menu).boxShadow).not.toContain("inset")
    const menuIcon = menu.querySelector("svg")
    if (!menuIcon) throw new Error("menu search has no icon")
    await expect(rect(menuIcon).width).toBe(16)
    await expect(style(menuIcon).color).toBe(
      dark ? "rgb(173, 169, 163)" : "rgb(142, 139, 134)",
    )
    await expect(rect(menuInput).width).toBe(198)
    await expect(rect(menuInput).height).toBe(20)

    // Settings search: inset ring, 4px 6px padding, icoTer icon
    const settings = canvas.getByTestId("settings")
    await expect(rect(settings).height).toBe(28)
    await expect(style(settings).padding).toBe("4px 6px")
    await expect(style(settings).boxShadow).toContain("inset")
    const settingsIcon = settings.querySelector("svg")
    if (!settingsIcon) throw new Error("settings search has no icon")
    await expect(style(settingsIcon).color).toBe(
      dark ? "rgb(125, 122, 117)" : "rgb(173, 169, 163)",
    )

    // Recipients: transparent 32px frame, 24px input with 2px padding
    const recipient = canvas.getByTestId("recipient")
    const recipientInput = canvas.getByRole("textbox", { name: "Empfänger" })
    await expect(rect(recipient).height).toBe(32)
    await expect(style(recipient).padding).toBe("2px 4px")
    await expect(style(recipient).backgroundColor).toBe("rgba(0, 0, 0, 0)")
    await expect(style(recipient).boxShadow).toContain(ring)
    await expect(rect(recipientInput).height).toBe(24)
    await expect(style(recipientInput).padding).toBe("2px")

    // Native inputs are bare 14/20 texPri text with a 0.375 placeholder
    for (const input of [menuInput, recipientInput]) {
      await expect(style(input).color).toBe(primary)
      await expect(style(input).fontSize).toBe("14px")
      await expect(style(input).lineHeight).toBe("20px")
      await expect(style(input).backgroundColor).toBe("rgba(0, 0, 0, 0)")
      await expect(style(input).boxShadow).toBe("none")
      await expect(style(input).borderRadius).toBe("0px")
      await expect(style(input, "::placeholder").color).toBe(primary)
      await expect(style(input, "::placeholder").opacity).toBe("0.375")
    }

    // Hover leaves the frame alone; focus snaps the blue ring onto the frame
    const idle = style(menu).boxShadow
    await userEvent.hover(menuInput)
    await expect(style(menu).boxShadow).toBe(idle)
    await userEvent.click(menuInput)
    await expect(style(menu).boxShadow).toContain(FOCUS_RING_BLUE)
    await expect(style(menu).transitionDuration).toBe("0s")
    await expect(style(menuInput).boxShadow).toBe("none")

    // Tab moves the ring from frame to frame
    await userEvent.tab()
    await userEvent.tab()
    await expect(recipientInput).toHaveFocus()
    await expect(style(recipient).boxShadow).toContain(FOCUS_RING_BLUE)
    await expect(style(menu).boxShadow).toBe(idle)
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
