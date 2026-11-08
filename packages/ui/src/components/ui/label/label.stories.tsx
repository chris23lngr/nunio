import { Field } from "@base-ui/react/field"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import { Input } from "../input/input.js"
import { Label } from "./label.js"

function NameField({
  labelProps,
  invalid = false,
  disabled = false,
}: {
  labelProps: Field.Label.Props
  invalid?: boolean
  disabled?: boolean
}) {
  return (
    <Field.Root
      invalid={invalid}
      disabled={disabled}
      className="flex w-96 max-w-full flex-col gap-2"
    >
      <Label {...labelProps} />
      <Input placeholder="John Doe" />
    </Field.Root>
  )
}

const meta = {
  title: "Components/new/Label",
  component: Label,
  args: { children: "Name" },
  render: (args) => <NameField labelProps={args} />,
} satisfies Meta<typeof Label>
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const label = canvas.getByText("Name")
    const input = canvas.getByRole("textbox", { name: "Name" })
    const style = getComputedStyle(label)
    await expect(label.tagName).toBe("LABEL")
    await expect(style.fontSize).toBe("14px")
    await expect(style.lineHeight).toBe("20px")
    await expect(style.fontWeight).toBe("500")
    await expect(style.color).toBe(tokenColor(canvasElement, "--base-800"))
    await expect(style.padding).toBe("0px")
    await expect(style.boxShadow).toBe("none")
    await expect(style.transitionDuration).toBe("0s")
    await userEvent.click(label)
    await expect(input).toHaveFocus()
    await expect(getComputedStyle(label).color).toBe(style.color)
    await expect(label).not.toHaveAttribute("tabindex")
  },
}

export const Invalid: Story = {
  render: (args) => <NameField labelProps={args} invalid />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const label = canvas.getByText("Name")
    const input = canvas.getByRole("textbox", { name: "Name" })
    await expect(label).toHaveAttribute("data-invalid")
    await expect(input).toHaveAttribute("aria-invalid", "true")
    await expect(getComputedStyle(label).color).toBe(
      tokenColor(canvasElement, "--destructive-700"),
    )
    await userEvent.click(label)
    await expect(input).toHaveFocus()
    await expect(getComputedStyle(label).color).toBe(
      tokenColor(canvasElement, "--destructive-700"),
    )
  },
}

export const Disabled: Story = {
  render: (args) => <NameField labelProps={args} disabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const label = canvas.getByText("Name")
    const input = canvas.getByRole("textbox", { name: "Name" })
    await expect(label).toHaveAttribute("data-disabled")
    await expect(getComputedStyle(label).opacity).toBe("0.5")
    await expect(input).toBeDisabled()
    await userEvent.click(label)
    await expect(input).not.toHaveFocus()
  },
}

export const Wrapping: Story = {
  args: { children: "Name as it appears on your university registration" },
  render: (args) => (
    <div className="w-40">
      <NameField labelProps={args} />
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    const label = within(canvasElement).getByText(String(args.children))
    const range = document.createRange()
    range.selectNodeContents(label)
    const lines = range.getClientRects().length
    await expect(lines).toBeGreaterThan(1)
    await expect(label.getBoundingClientRect().height).toBe(lines * 20)
    await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth)
    await expect(label.getBoundingClientRect().width).toBeLessThanOrEqual(160)
  },
}

export const CustomClassName: Story = {
  args: { className: () => "text-base-600" },
  play: async ({ canvasElement }) => {
    await expect(
      getComputedStyle(within(canvasElement).getByText("Name")).color,
    ).toBe(tokenColor(canvasElement, "--base-600"))
  },
}

export const Dark: Story = {
  ...Default,
  globals: { theme: "dark" },
}
