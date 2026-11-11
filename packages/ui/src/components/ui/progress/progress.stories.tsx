import type { Meta, StoryObj } from "@storybook/react-vite"
import type * as React from "react"
import { expect, within } from "storybook/test"
import { Progress } from "./progress.js"

const meta = {
  title: "Components/new/Progress",
  component: Progress,
  decorators: [
    (Story) => (
      <div className="w-50 p-4">
        <Story />
      </div>
    ),
  ],
  args: { value: 2, max: 4, "aria-label": "2 von 4 Stunden geplant" },
} satisfies Meta<typeof Progress>
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
    const bar = await within(canvasElement).findByRole("progressbar")
    await expect(bar.getBoundingClientRect().height).toBe(4)
    const track = bar.querySelector("[data-slot=progress-track]") as HTMLElement
    await expect(getComputedStyle(track).backgroundColor).toBe(
      tokenColor(canvasElement, "--base-200"),
    )
  },
}

export const HalfFilled: Story = {
  play: async ({ canvasElement }) => {
    const bar = await within(canvasElement).findByRole("progressbar", {
      name: "2 von 4 Stunden geplant",
    })
    await expect(bar).toHaveAttribute("aria-valuenow", "2")
    await expect(bar).toHaveAttribute("aria-valuemax", "4")
    const track = bar.querySelector("[data-slot=progress-track]") as HTMLElement
    const fill = bar.querySelector(
      "[data-slot=progress-indicator]",
    ) as HTMLElement
    await expect(fill.getBoundingClientRect().width).toBe(
      track.getBoundingClientRect().width / 2,
    )
    await expect(getComputedStyle(fill).backgroundColor).toBe(
      tokenColor(canvasElement, "--primary-500"),
    )
  },
}

export const CustomColor: Story = {
  args: {
    style: { "--progress-indicator": "var(--base-800)" } as React.CSSProperties,
  },
  play: async ({ canvasElement }) => {
    const bar = await within(canvasElement).findByRole("progressbar")
    const fill = bar.querySelector(
      "[data-slot=progress-indicator]",
    ) as HTMLElement
    await expect(getComputedStyle(fill).backgroundColor).toBe(
      tokenColor(canvasElement, "--base-800"),
    )
  },
}
