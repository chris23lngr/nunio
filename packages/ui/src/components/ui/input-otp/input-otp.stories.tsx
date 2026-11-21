import type { Meta, StoryObj } from "@storybook/react-vite"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import type * as React from "react"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "./input-otp.js"

// InputOTP's props are a union over `children` and `render`; stories supply children.
type InputOTPArgs = Omit<
  React.ComponentProps<typeof InputOTP>,
  "children" | "render"
>

const meta = {
  title: "Components/new/InputOTP",
  args: {
    "aria-label": "Bestätigungscode",
    maxLength: 6,
    pattern: REGEXP_ONLY_DIGITS,
    onChange: fn(),
    onComplete: fn(),
  },
  render: (args) => (
    <InputOTP {...args}>
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  ),
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<InputOTPArgs>
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

function parts(canvasElement: HTMLElement) {
  const input = within(canvasElement).getByRole("textbox", {
    name: "Bestätigungscode",
  })
  const group = canvasElement.querySelector(
    "[data-slot=input-otp-group]",
  ) as HTMLElement
  const slots = [
    ...canvasElement.querySelectorAll<HTMLElement>(
      "[data-slot=input-otp-slot]",
    ),
  ]
  return { input, group, slots }
}

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const { input, group, slots } = parts(canvasElement)
    await expect(input).toHaveAttribute("autocomplete", "one-time-code")
    await expect(input).toHaveAttribute("inputmode", "numeric")
    await expect(slots).toHaveLength(6)
    const slot = getComputedStyle(slots[0] as HTMLElement)
    await expect(slots[0]?.getBoundingClientRect().height).toBe(30)
    await expect(slots[0]?.getBoundingClientRect().width).toBe(30)
    await expect(slot.fontSize).toBe("14px")
    await expect(slot.fontWeight).toBe("500")
    await expect(slot.color).toBe(tokenColor(canvasElement, "--base-800"))
    const surface = getComputedStyle(group)
    await expect(surface.borderRadius).toBe("6px")
    await expect(surface.outlineWidth).toBe("1px")
    await expect(surface.backgroundColor).toBe(
      tokenColor(canvasElement, "--color-white"),
    )
  },
}

export const Typing: Story = {
  play: async ({ canvasElement, args }) => {
    const { input, slots } = parts(canvasElement)
    await userEvent.click(input)
    await userEvent.keyboard("12a3456")
    await expect(input).toHaveValue("123456")
    await expect(slots.map((slot) => slot.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ])
    await waitFor(() => expect(args.onComplete).toHaveBeenCalledWith("123456"))
    await userEvent.keyboard("{Backspace}")
    await expect(input).toHaveValue("12345")
  },
}

export const Paste: Story = {
  play: async ({ canvasElement, args }) => {
    const { input } = parts(canvasElement)
    await userEvent.click(input)
    await userEvent.paste("654321")
    await expect(input).toHaveValue("654321")
    await waitFor(() => expect(args.onComplete).toHaveBeenCalledWith("654321"))
  },
}

export const Focus: Story = {
  play: async ({ canvasElement }) => {
    const { input, group, slots } = parts(canvasElement)
    await userEvent.tab()
    await expect(input).toHaveFocus()
    await waitFor(() => expect(slots[0]).toHaveAttribute("data-active", "true"))
    const style = getComputedStyle(group)
    await expect(style.boxShadow).toContain(
      tokenColor(canvasElement, "--primary-500"),
    )
    await expect(style.getPropertyValue("--tw-ring-offset-width")).toBe("4px")
    await expect(slots[0]?.querySelector(".animate-caret-blink")).not.toBeNull()
    input.blur()
    await waitFor(() =>
      expect(getComputedStyle(group).boxShadow).not.toContain(
        tokenColor(canvasElement, "--primary-500"),
      ),
    )
  },
}

export const Invalid: Story = {
  args: { defaultValue: "123456" },
  render: (args) => (
    <InputOTP {...args}>
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <InputOTPSlot key={index} index={index} aria-invalid />
        ))}
      </InputOTPGroup>
    </InputOTP>
  ),
  play: async ({ canvasElement }) => {
    const { input, group } = parts(canvasElement)
    const invalidColor = tokenColor(canvasElement, "--destructive-500")
    await expect(getComputedStyle(group).boxShadow).toContain(invalidColor)
    await userEvent.click(input)
    const style = getComputedStyle(group)
    await expect(style.boxShadow).toContain(invalidColor)
    await expect(style.boxShadow).not.toContain(
      tokenColor(canvasElement, "--primary-500"),
    )
  },
}

export const Disabled: Story = {
  args: { defaultValue: "123", disabled: true },
  play: async ({ canvasElement, args }) => {
    const { input } = parts(canvasElement)
    await expect(input).toBeDisabled()
    const container = input.closest("[data-input-otp-container]") as HTMLElement
    await expect(getComputedStyle(container).opacity).toBe("0.5")
    input.focus()
    await expect(input).not.toHaveFocus()
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

export const WithSeparator: Story = {
  render: (args) => (
    <InputOTP {...args}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  ),
  play: async ({ canvasElement }) => {
    const { input } = parts(canvasElement)
    const separator = within(canvasElement).getByRole("separator")
    await expect(getComputedStyle(separator).color).toBe(
      tokenColor(canvasElement, "--base-500"),
    )
    const groups = [
      ...canvasElement.querySelectorAll<HTMLElement>(
        "[data-slot=input-otp-group]",
      ),
    ]
    await userEvent.click(input)
    await userEvent.keyboard("1234")
    const ring = tokenColor(canvasElement, "--primary-500")
    await expect(
      getComputedStyle(groups[1] as HTMLElement).boxShadow,
    ).toContain(ring)
    await expect(
      getComputedStyle(groups[0] as HTMLElement).boxShadow,
    ).not.toContain(ring)
  },
}

export const Dark: Story = {
  ...Empty,
  globals: { theme: "dark" },
}
