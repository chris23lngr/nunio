import { Field } from "@base-ui/react/field"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, userEvent, within } from "storybook/test"
import { Input } from "./input.js"
import { Label } from "./label.js"

const meta = {
  title: "Components/Input",
  component: Input,
  args: { "aria-label": "Bevorzugter Name", placeholder: "Bevorzugter Name" },
} satisfies Meta<typeof Input>
export default meta

type Story = StoryObj<typeof meta>

const FOCUS_RING_BLUE = "rgb(35, 131, 226)"

export const Playground: Story = {
  render: (args) => <Input className="w-[250px]" {...args} />,
}

function ControlledExample() {
  const [value, setValue] = useState("")
  return (
    <div className="flex flex-col gap-3">
      <Field.Root className="flex flex-col gap-1">
        <Label variant="compact">Filter</Label>
        <Input
          value={value}
          onValueChange={setValue}
          className={(state) => (state.filled ? "font-medium" : undefined)}
        />
      </Field.Root>
      <output aria-label="Current value">{value}</output>
      <Input aria-label="Disabled" disabled defaultValue="Unavailable" />
      <Input aria-label="Read only" readOnly defaultValue="Read only" />
    </div>
  )
}

export const Editing: Story = {
  render: () => <ControlledExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole("textbox", { name: "Filter" })
    await userEvent.type(input, "Notion")
    await expect(input).toHaveValue("Notion")
    await expect(canvas.getByLabelText("Current value")).toHaveTextContent(
      "Notion",
    )
    // Field state reaches data attributes and the className callback
    await expect(input).toHaveAttribute("data-filled")
    await expect(input).toHaveAttribute("data-dirty")
    await expect(getComputedStyle(input).fontWeight).toBe("500")
    await userEvent.clear(input)
    await expect(input).not.toHaveAttribute("data-filled")

    const disabled = canvas.getByRole("textbox", { name: "Disabled" })
    await expect(disabled).toBeDisabled()
    await expect(getComputedStyle(disabled).opacity).toBe("0.4")
    const readOnly = canvas.getByRole("textbox", { name: "Read only" })
    await userEvent.type(readOnly, "ignored")
    await expect(readOnly).toHaveValue("Read only")
  },
}

// Values from docs/notion-spec/components/input.md (Settings, "Bevorzugter Name")
export const SpecStyling: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Field.Root className="flex flex-col gap-1">
        <Label variant="compact">Bevorzugter Name</Label>
        <Input className="w-[250px]" defaultValue="Christoph Langer" />
      </Field.Root>
      <Input className="w-[250px]" aria-label="Leer" placeholder="Name" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const dark = document.documentElement.classList.contains("dark")
    const canvas = within(canvasElement)
    const input = canvas.getByRole("textbox", { name: "Bevorzugter Name" })
    const empty = canvas.getByRole("textbox", { name: "Leer" })
    const style = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo)
    const primary = dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)"

    // 28px bacSecTra field, 4px 10px padding, 6px radius, 14/20 regular texPri
    await expect(input.getBoundingClientRect().height).toBe(28)
    await expect(style(input).padding).toBe("4px 10px")
    await expect(style(input).borderRadius).toBe("6px")
    await expect(style(input).fontSize).toBe("14px")
    await expect(style(input).lineHeight).toBe("20px")
    await expect(style(input).fontWeight).toBe("400")
    await expect(style(input).color).toBe(primary)
    await expect(style(input).cursor).toBe("text")
    await expect(style(input).backgroundColor).toBe(
      dark ? "rgba(252, 252, 252, 0.03)" : "rgba(66, 35, 3, 0.03)",
    )

    // Placeholder is texPri at 0.375 opacity, not a tertiary color
    await expect(style(empty, "::placeholder").color).toBe(primary)
    await expect(style(empty, "::placeholder").opacity).toBe("0.375")

    // Outward borPriTra ring; hover changes nothing
    const idleShadow = style(input).boxShadow
    await expect(idleShadow).toContain(
      dark ? "rgba(255, 255, 235, 0.1)" : "rgba(28, 19, 1, 0.11)",
    )
    await expect(idleShadow).not.toContain("inset")
    await userEvent.hover(input)
    await expect(style(input).boxShadow).toBe(idleShadow)

    // Focus swaps in the blue ring instantly and blur restores the idle ring
    await userEvent.click(input)
    await expect(style(input).boxShadow).toContain(FOCUS_RING_BLUE)
    await expect(style(input).transitionDuration).toBe("0s")
    await userEvent.tab()
    await expect(empty).toHaveFocus()
    await expect(style(input).boxShadow).toBe(idleShadow)
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
