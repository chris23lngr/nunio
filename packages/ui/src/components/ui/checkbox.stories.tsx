import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Checkbox } from "./checkbox.js"

const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
} satisfies Meta<typeof Checkbox>
export default meta

type Story = StoryObj<typeof meta>

const style = (el: Element) => getComputedStyle(el)

export const Basic: Story = {
  args: { "aria-label": "ToDo 1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const root = canvas.getByRole("checkbox", { name: "ToDo 1" })
    await expect(root).toHaveAttribute("aria-checked", "false")
    await expect(root.querySelector("svg")).toBeNull()

    // A click checks it and mounts the tick at once
    await userEvent.click(root)
    await expect(root).toHaveAttribute("aria-checked", "true")
    await expect(root.querySelector("svg")).not.toBeNull()

    // Space unchecks it from the keyboard and removes the tick
    await userEvent.keyboard(" ")
    await expect(root).toHaveAttribute("aria-checked", "false")
    await waitFor(() => expect(root.querySelector("svg")).toBeNull())
  },
}

// Values from docs/notion-spec/components/checkbox.md
export const SpecStyling: Story = {
  render: () => (
    <div className="flex gap-4">
      <Checkbox aria-label="ToDo 1" data-testid="off" />
      <Checkbox aria-label="ToDo 2" defaultChecked data-testid="on" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const dark = document.documentElement.classList.contains("dark")
    const canvas = within(canvasElement)
    const off = canvas.getByTestId("off")
    const on = canvas.getByTestId("on")

    // 16px box, 1.5px radius, eased background
    for (const el of [off, on]) {
      await expect(el.getBoundingClientRect().width).toBe(16)
      await expect(el.getBoundingClientRect().height).toBe(16)
      await expect(style(el).borderRadius).toBe("1.5px")
      await expect(style(el).transitionDuration).toBe("0.2s")
      await expect(style(el).transitionTimingFunction).toBe("ease-out")
      await expect(style(el).cursor).toBe("pointer")
    }

    // Unchecked: 1.5px icoPri frame (Chrome rounds it to 1px at 1x pixel
    // density, 1.5px at 2x), transparent
    await expect(style(off).borderTopStyle).toBe("solid")
    await expect(
      Number.parseFloat(style(off).borderTopWidth),
    ).toBeGreaterThanOrEqual(1)
    await expect(style(off).backgroundColor).toBe("rgba(0, 0, 0, 0)")

    // Checked: no frame, bluBacAccPri fill (#2783de, not the ring's #2383e2),
    // white 14px tick centred
    await expect(style(on).borderTopWidth).toBe("0px")
    await expect(style(on).backgroundColor).toBe("rgb(39, 131, 222)")
    const tick = on.querySelector("svg") as SVGElement
    await expect(tick.getBoundingClientRect().width).toBe(14)
    await expect(
      tick.getBoundingClientRect().left - on.getBoundingClientRect().left,
    ).toBe(1)
    await expect(style(tick).fill).toBe("rgb(255, 255, 255)")

    // Keyboard focus draws the blue button ring
    await userEvent.tab()
    await expect(off).toHaveFocus()
    await expect(style(off).boxShadow).toContain(
      "rgb(35, 131, 226) 0px 0px 0px 4px",
    )
    await expect(style(off).boxShadow).toContain(
      dark
        ? "rgb(25, 25, 25) 0px 0px 0px 2px"
        : "rgb(248, 248, 247) 0px 0px 0px 2px",
    )
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
