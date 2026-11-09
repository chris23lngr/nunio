import { Field } from "@base-ui/react/field"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fn, userEvent, within } from "storybook/test"
import { Label } from "../label/label.js"
import { Checkbox } from "./checkbox.js"

const meta = {
  title: "Components/new/Checkbox",
  component: Checkbox,
  args: { "aria-label": "Accept terms", onCheckedChange: fn() },
  argTypes: {
    checked: { control: "boolean" },
    indeterminate: { control: "boolean" },
    disabled: { control: "boolean" },
    "aria-invalid": { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Checkbox>
export default meta

type Story = StoryObj<typeof meta>

function tokenColor(canvas: HTMLElement, token: string) {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  canvas.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const root = within(canvasElement).getByRole("checkbox")
    const style = getComputedStyle(root)
    await expect(root.getBoundingClientRect().width).toBe(16)
    await expect(root.getBoundingClientRect().height).toBe(16)
    await expect(style.borderRadius).toBe("4px")
    await expect(style.outlineWidth).toBe("1px")
    await expect(style.backgroundColor).toBe(
      tokenColor(canvasElement, "--color-white"),
    )
    await expect(style.boxShadow).not.toBe("none")
    await expect(style.transitionDuration).toBe("0s")
    await expect(root).toHaveAttribute("aria-checked", "false")
    const background = style.backgroundColor
    await userEvent.hover(root)
    await expect(getComputedStyle(root).backgroundColor).toBe(background)
    await userEvent.click(root)
    await expect(root).toHaveAttribute("aria-checked", "true")
    await expect(args.onCheckedChange).toHaveBeenCalled()
    await expect(getComputedStyle(root).backgroundColor).toBe(
      tokenColor(canvasElement, "--primary-400"),
    )
    await userEvent.tab({ shift: true })
    await userEvent.tab()
    root.focus()
    await userEvent.keyboard(" ")
    await expect(root).toHaveAttribute("aria-checked", "false")
  },
}

export const Checked: Story = {
  args: { defaultChecked: true },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement).getByRole("checkbox")
    await expect(root).toHaveAttribute("aria-checked", "true")
    await expect(getComputedStyle(root).backgroundColor).toBe(
      tokenColor(canvasElement, "--primary-400"),
    )
    await expect(root.querySelector(".lucide-check")).toBeVisible()
    await expect(root.querySelector(".lucide-minus")).not.toBeVisible()
    const icon = root.querySelector(".lucide-check") as SVGElement
    await expect(icon.getBoundingClientRect().width).toBe(16)
    await expect(getComputedStyle(icon).stroke).toBe(
      tokenColor(canvasElement, "--color-white"),
    )
  },
}

export const Indeterminate: Story = {
  args: { indeterminate: true },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement).getByRole("checkbox")
    await expect(root).toHaveAttribute("aria-checked", "mixed")
    await expect(getComputedStyle(root).backgroundColor).toBe(
      tokenColor(canvasElement, "--primary-400"),
    )
    await expect(root.querySelector(".lucide-minus")).toBeVisible()
    await expect(root.querySelector(".lucide-check")).not.toBeVisible()
  },
}

export const Focus: Story = {
  render: (args) => (
    <div className="flex gap-8">
      <Checkbox {...args} aria-label="Unchecked" />
      <Checkbox {...args} aria-label="Checked" defaultChecked />
      <Checkbox {...args} aria-label="Mixed" indeterminate />
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const root of within(canvasElement).getAllByRole("checkbox")) {
      await userEvent.tab()
      root.focus()
      await expect(root).toHaveFocus()
      await expect(root.matches(":focus-visible")).toBe(true)
      const style = getComputedStyle(root)
      await expect(style.boxShadow).toContain(
        tokenColor(canvasElement, "--primary-500"),
      )
      await expect(style.boxShadow).toContain(
        tokenColor(canvasElement, "--color-white"),
      )
      await expect(style.getPropertyValue("--tw-ring-offset-width")).toBe("4px")
      await expect(style.getPropertyValue("--tw-ring-shadow")).toContain("2px")
    }
  },
}

export const Invalid: Story = {
  args: { "aria-invalid": true },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement).getByRole("checkbox")
    const red = tokenColor(canvasElement, "--destructive-500")
    await expect(getComputedStyle(root).boxShadow).toContain(red)
    await userEvent.tab()
    root.focus()
    await expect(getComputedStyle(root).boxShadow).toContain(red)
    await expect(getComputedStyle(root).boxShadow).not.toContain(
      tokenColor(canvasElement, "--primary-500"),
    )
    await userEvent.keyboard(" ")
    await expect(root).toHaveAttribute("aria-checked", "true")
    await expect(getComputedStyle(root).backgroundColor).toBe(
      tokenColor(canvasElement, "--primary-400"),
    )
    root.blur()
    await expect(getComputedStyle(root).boxShadow).toContain(red)
  },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const StateCombinations: Story = {
  render: (args) => (
    <div className="grid grid-cols-3 gap-8">
      {[false, true].flatMap((disabled) =>
        [false, true].flatMap((invalid) =>
          ["unchecked", "checked", "mixed"].map((state) => (
            <Checkbox
              {...args}
              key={`${disabled}-${invalid}-${state}`}
              aria-label={`${state}${invalid ? " invalid" : ""}${disabled ? " disabled" : ""}`}
              defaultChecked={state === "checked"}
              indeterminate={state === "mixed"}
              disabled={disabled}
              aria-invalid={invalid}
            />
          )),
        ),
      )}
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    for (const root of within(canvasElement).getAllByRole("checkbox")) {
      const name = root.getAttribute("aria-label") ?? ""
      const disabled = name.includes("disabled")
      const invalid = name.includes("invalid")
      const selected = !name.startsWith("unchecked")
      const style = getComputedStyle(root)
      await expect(style.opacity).toBe(disabled ? "0.5" : "1")
      await expect(style.backgroundColor).toBe(
        tokenColor(canvasElement, selected ? "--primary-400" : "--color-white"),
      )
      if (invalid)
        await expect(style.boxShadow).toContain(
          tokenColor(canvasElement, "--destructive-500"),
        )
      if (disabled) {
        await expect(root).toHaveAttribute("aria-disabled", "true")
        const checked = root.getAttribute("aria-checked")
        await expect(root).toHaveAttribute("tabindex", "-1")
        // DOM click also verifies Base UI rejects activation without relying on CSS.
        root.click()
        await expect(root).toHaveAttribute("aria-checked", checked)
      }
    }
    await expect(args.onCheckedChange).not.toHaveBeenCalled()
  },
}

function ControlledField() {
  const [checked, setChecked] = useState(false)
  return (
    <Field.Root invalid className="flex items-center gap-3">
      <Checkbox checked={checked} onCheckedChange={setChecked} />
      <Label>Accept terms</Label>
    </Field.Root>
  )
}

export const WithLabel: Story = {
  render: () => <ControlledField />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const root = canvas.getByRole("checkbox", { name: "Accept terms" })
    await expect(root).toHaveAttribute("aria-invalid", "true")
    await expect(getComputedStyle(root).boxShadow).toContain(
      tokenColor(canvasElement, "--destructive-500"),
    )
    await userEvent.click(canvas.getByText("Accept terms"))
    await expect(root).toHaveAttribute("aria-checked", "true")
  },
}

export const CustomClassName: Story = {
  args: {
    className: (state) =>
      state.checked ? "data-checked:bg-primary-600" : "bg-base-100",
  },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement).getByRole("checkbox")
    await expect(getComputedStyle(root).backgroundColor).toBe(
      tokenColor(canvasElement, "--base-100"),
    )
    await userEvent.click(root)
    await expect(getComputedStyle(root).backgroundColor).toBe(
      tokenColor(canvasElement, "--primary-600"),
    )
  },
}
