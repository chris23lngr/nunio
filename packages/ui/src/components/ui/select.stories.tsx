import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./select.js"

const meta = {
  title: "Components/Select",
  component: Select,
} satisfies Meta<typeof Select>
export default meta

type Story = StoryObj<typeof meta>

const body = within(document.body)

const DESIGNS = [
  { value: "system", label: "Systemeinstellung verwenden" },
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
]

// Notion's Settings "Design" select
function DesignSelect(props: React.ComponentProps<typeof Select>) {
  return (
    <Select items={DESIGNS} defaultValue="system" {...props}>
      <div className="flex w-[480px] items-center justify-between gap-4">
        <SelectLabel>Design</SelectLabel>
        <SelectTrigger data-testid="trigger">
          <SelectValue />
        </SelectTrigger>
      </div>
      <SelectContent data-testid="popup">
        {DESIGNS.map((design) => (
          <SelectItem
            key={design.value}
            value={design.value}
            data-testid={design.value}
          >
            {design.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export const Basic: Story = {
  render: () => <DesignSelect />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("combobox", { name: /Design/ })
    await expect(trigger).toHaveTextContent("Systemeinstellung verwenden")

    // The selected option carries the check; the others do not
    await userEvent.click(trigger)
    const list = await body.findByRole("listbox")
    const system = within(list).getByRole("option", { name: /System/ })
    await expect(system).toHaveAttribute("aria-selected", "true")
    await expect(system.querySelector("svg")).not.toBeNull()
    await expect(
      within(list).getByRole("option", { name: "Hell" }).querySelector("svg"),
    ).toBeNull()

    // Picking an option closes the popup, shows the value, returns focus
    await userEvent.click(within(list).getByRole("option", { name: "Dunkel" }))
    await waitFor(() => expect(body.queryByRole("listbox")).toBeNull())
    await expect(trigger).toHaveTextContent("Dunkel")
    await expect(trigger).toHaveFocus()
  },
}

// Blue layer of the focus-button shadow (Notion butBluFocRin)
const FOCUS_RING_BLUE = "rgb(35, 131, 226)"
const TRANSPARENT = "rgba(0, 0, 0, 0)"

// Notion rings the active row only when the keyboard moved there
export const KeyboardHighlight: Story = {
  render: () => <DesignSelect />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox")
    await userEvent.click(trigger)
    const list = await body.findByRole("listbox")
    const [, light, dark] = within(list).getAllByRole("option")
    if (!light || !dark) throw new Error("expected three options")

    // Keys pressed before focus moves into the popup go to the trigger
    await waitFor(() =>
      expect(list.contains(document.activeElement)).toBe(true),
    )

    // Arrow keys: background and the focus ring
    await userEvent.keyboard("{ArrowDown}")
    await waitFor(() => expect(light).toHaveAttribute("data-highlighted"))
    await waitFor(() =>
      expect(getComputedStyle(light).boxShadow).toContain(FOCUS_RING_BLUE),
    )

    // Pointer: background only
    await userEvent.hover(dark)
    await waitFor(() => expect(dark).toHaveAttribute("data-highlighted"))
    await waitFor(() =>
      expect(getComputedStyle(dark).backgroundColor).not.toBe(TRANSPARENT),
    )
    await expect(getComputedStyle(dark).boxShadow).not.toContain(
      FOCUS_RING_BLUE,
    )

    // Escape closes and returns focus to the trigger
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByRole("listbox")).toBeNull())
    await expect(trigger).toHaveFocus()
  },
}

// Values from docs/notion-spec/components/select.md
export const SpecStyling: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <DesignSelect open />
      <Select items={DESIGNS} defaultValue="system" disabled>
        <SelectTrigger data-testid="disabled" aria-label="Zeitzone">
          <SelectValue />
        </SelectTrigger>
      </Select>
    </div>
  ),
  play: async () => {
    const dark = document.documentElement.classList.contains("dark")
    const style = (el: Element) => getComputedStyle(el)
    const rect = (el: Element) => el.getBoundingClientRect()
    const trigger = body.getByTestId("trigger")
    const popup = await body.findByTestId("popup")
    await waitFor(() => expect(style(popup).opacity).toBe("1"))

    // Outlined, content-width trigger: 28px, 0 8px, 6px radius, 14px medium
    await expect(rect(trigger).height).toBe(28)
    await expect(style(trigger).padding).toBe("0px 8px")
    await expect(style(trigger).columnGap).toBe("6px")
    await expect(style(trigger).borderRadius).toBe("6px")
    await expect(style(trigger).borderWidth).toBe("1px")
    // borPriTra: light #1c13011c, dark #ffffeb1a
    await expect(style(trigger).borderColor).toMatch(
      dark ? /^rgba\(255, 255, 235, 0\.1/ : /^rgba\(28, 19, 1, 0\.1/,
    )
    await expect(style(trigger).fontSize).toBe("14px")
    await expect(style(trigger).fontWeight).toBe("500")
    // Open keeps the interactive fill (bacIntTra)
    await expect(style(trigger).backgroundColor).not.toBe(TRANSPARENT)
    const chevron = trigger.querySelector("svg")
    if (!chevron) throw new Error("trigger has no chevron")
    await expect(rect(chevron).height).toBe(14)

    // popBac surface with shaOutLg, 250px wide, 10px radius
    await expect(rect(popup).width).toBe(250)
    await expect(style(popup).borderRadius).toBe("10px")
    await expect(style(popup).backgroundColor).toBe(
      dark ? "rgb(37, 37, 37)" : "rgb(255, 255, 255)",
    )
    await expect(style(popup).boxShadow).toContain(
      dark ? "rgb(56, 56, 54) 0px 0px 0px 1px" : "0px 20px 24px 0px",
    )

    // 4px below the trigger, aligned to its end
    await expect(Math.round(rect(popup).top - rect(trigger).bottom)).toBe(4)
    await expect(
      Math.round(rect(popup).right - rect(trigger).right),
    ).toBeCloseTo(0, 0)

    // Three 28px rows with 1px gaps inside 4px padding: 94px
    await expect(rect(popup).height).toBe(94)
    const system = body.getByTestId("system")
    await expect(rect(system).width).toBe(242)
    await expect(rect(system).height).toBe(28)
    await expect(style(system).paddingLeft).toBe("8px")
    await expect(style(system).columnGap).toBe("8px")
    await expect(style(system).fontSize).toBe("14px")
    await expect(style(system).fontWeight).toBe("400")
    const check = system.querySelector("svg")
    if (!check) throw new Error("selected option has no check")
    await expect(rect(check).width).toBe(16)
    await expect(style(check).color).toBe(
      dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)",
    )

    // Disabled: the whole trigger at 0.4 opacity
    await expect(style(body.getByTestId("disabled")).opacity).toBe("0.4")
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
