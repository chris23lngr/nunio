import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { Input } from "./input.js"

const meta = {
  title: "Components/new/Input",
  component: Input,
  args: { "aria-label": "Name", placeholder: "John Doe", onChange: fn() },
  argTypes: {
    disabled: { control: "boolean" },
    readOnly: { control: "boolean" },
    "aria-invalid": { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div className="w-96 max-w-full p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>
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

export const Placeholder: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Name" })
    const style = getComputedStyle(input)
    await expect(input.getBoundingClientRect().height).toBe(30)
    await expect(style.borderRadius).toBe("6px")
    await expect(style.paddingLeft).toBe("10px")
    await expect(style.paddingRight).toBe("10px")
    await expect(style.fontSize).toBe("14px")
    await expect(style.lineHeight).toBe("20px")
    await expect(style.fontWeight).toBe("500")
    await expect(style.transitionDuration).toBe("0s")
    await expect(style.color).toBe(tokenColor(canvasElement, "--base-800"))
    await expect(getComputedStyle(input, "::placeholder").color).toBe(
      tokenColor(canvasElement, "--base-500"),
    )
  },
}

export const Filled: Story = {
  args: { defaultValue: "John Doe" },
  play: async ({ canvasElement, args }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Name" })
    await expect(input).toHaveValue("John Doe")
    await userEvent.clear(input)
    await userEvent.type(input, "Jane Doe")
    await expect(input).toHaveValue("Jane Doe")
    await expect(args.onChange).toHaveBeenCalled()
  },
}

export const Focus: Story = {
  args: { defaultValue: "John Doe" },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Name" })
    await userEvent.tab()
    input.focus()
    await expect(input).toHaveFocus()
    await expect(input.matches(":focus-visible")).toBe(true)
    const style = getComputedStyle(input)
    await expect(style.boxShadow).toContain(
      tokenColor(canvasElement, "--primary-500"),
    )
    await expect(style.boxShadow).toContain(
      tokenColor(canvasElement, "--color-white"),
    )
    await expect(style.getPropertyValue("--tw-ring-offset-width")).toBe("4px")
    await expect(style.outlineWidth).toBe("1px")
  },
}

export const Invalid: Story = {
  args: { defaultValue: "John Doe", "aria-invalid": true },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Name" })
    const invalidColor = tokenColor(canvasElement, "--destructive-500")
    await expect(getComputedStyle(input).boxShadow).toContain(invalidColor)
    await userEvent.tab()
    input.focus()
    await expect(input).toHaveFocus()
    const style = getComputedStyle(input)
    await expect(style.boxShadow).toContain(invalidColor)
    await expect(style.boxShadow).not.toContain(
      tokenColor(canvasElement, "--primary-500"),
    )
    await expect(style.boxShadow).toContain(
      tokenColor(canvasElement, "--color-white"),
    )
    await expect(style.color).toBe(tokenColor(canvasElement, "--base-800"))
    await expect(style.getPropertyValue("--tw-ring-offset-width")).toBe("4px")
    input.blur()
    await expect(getComputedStyle(input).boxShadow).toContain(invalidColor)
  },
}

export const Disabled: Story = {
  args: { defaultValue: "John Doe", disabled: true },
  play: async ({ canvasElement, args }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Name" })
    await expect(input).toBeDisabled()
    await expect(getComputedStyle(input).opacity).toBe("0.5")
    await expect(getComputedStyle(input).backgroundColor).toBe(
      tokenColor(canvasElement, "--color-white"),
    )
    input.focus()
    await expect(input).not.toHaveFocus()
    await expect(input).toHaveValue("John Doe")
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

export const ReadOnly: Story = {
  args: { defaultValue: "John Doe", readOnly: true },
  play: async ({ canvasElement, args }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Name" })
    await userEvent.type(input, " ignored")
    await expect(input).toHaveValue("John Doe")
    await expect(input).toHaveFocus()
    await expect(getComputedStyle(input).opacity).toBe("1")
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

export const NarrowContainer: Story = {
  render: (args) => (
    <div className="w-40">
      <Input
        {...args}
        defaultValue="A long name that exceeds the input width"
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Name" })
    await expect(input.getBoundingClientRect().width).toBe(160)
    await userEvent.click(input)
    await userEvent.keyboard("{End}!")
    await expect(input).toHaveValue("A long name that exceeds the input width!")
  },
}

export const File: Story = {
  args: { type: "file", "aria-label": "Upload file", placeholder: undefined },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText("Upload file")
    const file = new window.File(["Example"], "example.txt", {
      type: "text/plain",
    })
    await userEvent.upload(input, file)
    await expect((input as HTMLInputElement).files?.[0]?.name).toBe(
      "example.txt",
    )
  },
}

export const Dark: Story = {
  ...Placeholder,
  globals: { theme: "dark" },
}
