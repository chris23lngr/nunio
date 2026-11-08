import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowUpCircle } from "lucide-react"
import { expect, fn, userEvent, within } from "storybook/test"
import { Button } from "./button.js"

const variants = ["primary", "outline", "destructive", "ghost"] as const
const sizes = ["sm", "default", "lg", "icon-sm", "icon", "icon-lg"] as const
const heights = [26, 30, 34, 26, 30, 34]

const meta = {
  title: "Components/new/Button",
  component: Button,
  args: { children: "Hello World", onClick: fn() },
  argTypes: {
    variant: { control: "select", options: variants },
    size: { control: "select", options: sizes },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Gallery: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <table className="border-separate border-spacing-6 text-sm">
      <caption className="text-left font-medium">Variants and sizes</caption>
      <thead>
        <tr>
          <th scope="col">Variant</th>
          {sizes.map((size) => (
            <th key={size} scope="col">
              {size}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {variants.map((variant) => (
          <tr key={variant}>
            <th scope="row" className="text-left font-medium">
              {variant}
            </th>
            {sizes.map((size) => (
              <td key={size}>
                <Button
                  {...args}
                  variant={variant}
                  size={size}
                  data-testid={`${variant}-${size}`}
                  aria-label={
                    size.startsWith("icon") ? `${variant} action` : undefined
                  }
                >
                  {size.startsWith("icon") ? <ArrowUpCircle /> : "Hello World"}
                </Button>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const variant of variants) {
      for (const [index, size] of sizes.entries()) {
        const button = canvas.getByTestId(`${variant}-${size}`)
        const style = getComputedStyle(button)
        await expect(button.getBoundingClientRect().height).toBe(heights[index])
        await expect(style.borderRadius).toBe("6px")
        await expect(style.fontSize).toBe("14px")
        await expect(style.lineHeight).toBe("20px")
        await expect(style.fontWeight).toBe("500")
        await expect(style.transitionDuration).toBe("0s")
        if (size.startsWith("icon")) {
          await expect(button.getBoundingClientRect().width).toBe(
            heights[index],
          )
          await expect(style.paddingLeft).toBe("0px")
          await expect(style.paddingRight).toBe("0px")
          await expect(
            button.querySelector("svg")?.getBoundingClientRect().width,
          ).toBe(16)
        }
      }
    }
  },
}

export const Disabled: Story = {
  ...Gallery,
  args: { disabled: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    for (const variant of variants) {
      for (const size of sizes) {
        const button = canvas.getByTestId(`${variant}-${size}`)
        await expect(button).toBeDisabled()
        await expect(getComputedStyle(button).opacity).toBe("0.5")
      }
    }
    const button = canvas.getByTestId("outline-sm")
    button.click()
    button.focus()
    await userEvent.keyboard("{Enter} ")
    await expect(button).not.toHaveFocus()
    await expect(args.onClick).not.toHaveBeenCalled()
  },
}

export const Icons: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-6">
      {variants.map((variant) => (
        <div key={variant} className="flex items-center gap-4">
          <Button {...args} variant={variant} data-testid={`${variant}-start`}>
            <ArrowUpCircle data-icon="inline-start" />
            Hello World
          </Button>
          <Button {...args} variant={variant} data-testid={`${variant}-end`}>
            Hello World
            <ArrowUpCircle data-icon="inline-end" />
          </Button>
        </div>
      ))}
      <Button data-testid="custom-icon" className={() => "px-4"}>
        <ArrowUpCircle
          data-icon="inline-start"
          className="size-5 text-base-600"
        />
        Custom icon
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const variant of variants) {
      const button = canvas.getByTestId(`${variant}-start`)
      const icon = button.querySelector("svg")
      if (!icon) throw new Error("Missing Button icon")
      const labelToken =
        variant === "primary"
          ? "--primary-950"
          : variant === "destructive"
            ? "--destructive-700"
            : "--base-800"
      const iconToken =
        variant === "primary"
          ? "--primary-900"
          : variant === "destructive"
            ? "--destructive-500"
            : "--base-500"
      await expect(getComputedStyle(button).color).toBe(
        tokenColor(canvasElement, labelToken),
      )
      await expect(getComputedStyle(icon).color).toBe(
        tokenColor(canvasElement, iconToken),
      )
      const start = getComputedStyle(canvas.getByTestId(`${variant}-start`))
      const end = getComputedStyle(canvas.getByTestId(`${variant}-end`))
      await expect([start.paddingLeft, start.paddingRight, start.gap]).toEqual([
        "8px",
        "10px",
        "8px",
      ])
      await expect([end.paddingLeft, end.paddingRight, end.gap]).toEqual([
        "10px",
        "8px",
        "8px",
      ])
    }
    const custom = canvas.getByTestId("custom-icon")
    await expect(
      custom.querySelector("svg")?.getBoundingClientRect().width,
    ).toBe(20)
    await expect(getComputedStyle(custom).paddingRight).toBe("16px")
    const customIcon = custom.querySelector("svg")
    if (!customIcon) throw new Error("Missing custom icon")
    await expect(getComputedStyle(customIcon).color).toBe(
      tokenColor(canvasElement, "--base-600"),
    )
  },
}

function tokenColor(canvas: HTMLElement, token: string) {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  canvas.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

export const InteractionStates: Story = {
  render: (args) => (
    <div className="flex gap-6 p-6">
      {variants.map((variant) => (
        <Button {...args} key={variant} variant={variant} data-testid={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    for (const variant of variants) {
      const button = canvas.getByTestId(variant)
      button.focus()
      await expect(button).toHaveFocus()
      await expect(button.matches(":focus-visible")).toBe(true)
      const style = getComputedStyle(button)
      await expect(style.getPropertyValue("--tw-ring-offset-width")).toBe("4px")
      await expect(style.boxShadow).toContain(
        tokenColor(canvasElement, "--color-white"),
      )
      await expect(style.boxShadow).not.toBe("none")
    }
    const primary = canvas.getByTestId("primary")
    primary.focus()
    await userEvent.keyboard("{Enter}")
    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

export const GalleryDark: Story = {
  ...Gallery,
  globals: { theme: "dark" },
}
