import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { Switch } from "./switch.js"

const meta = {
  title: "Components/new/Switch",
  component: Switch,
  args: { "aria-label": "Quiet hours", onCheckedChange: fn() },
  argTypes: {
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
    size: { control: "inline-radio", options: ["default", "sm"] },
  },
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Switch>
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

function getThumb(root: HTMLElement) {
  return root.querySelector("[data-slot=switch-thumb]") as HTMLElement
}

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const root = within(canvasElement).getByRole("switch")
    const thumb = getThumb(root)
    const track = root.getBoundingClientRect()
    await expect(track.width).toBe(32)
    await expect(track.height).toBe(18)
    await expect(thumb.getBoundingClientRect().width).toBe(14)
    await expect(thumb.getBoundingClientRect().height).toBe(14)
    const style = getComputedStyle(root)
    await expect(style.outlineWidth).toBe("1px")
    await expect(style.boxShadow).toContain(
      "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px",
    )
    await expect(style.backgroundColor).toBe(
      tokenColor(canvasElement, "--color-white"),
    )
    await expect(getComputedStyle(thumb).backgroundColor).toBe(
      tokenColor(canvasElement, "--base-500"),
    )
    await expect(root).toHaveAttribute("aria-checked", "false")
    await userEvent.click(root)
    await expect(root).toHaveAttribute("aria-checked", "true")
    await expect(args.onCheckedChange).toHaveBeenCalledTimes(1)
  },
}

async function expectThumbAt(root: HTMLElement, edge: "start" | "end") {
  const track = root.getBoundingClientRect()
  const thumb = getThumb(root).getBoundingClientRect()
  await expect(thumb.top - track.top).toBeCloseTo(track.bottom - thumb.bottom)
  if (edge === "start") await expect(thumb.left - track.left).toBeCloseTo(2)
  else await expect(track.right - thumb.right).toBeCloseTo(2)
}

export const Checked: Story = {
  args: { defaultChecked: true },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement).getByRole("switch")
    const primary = tokenColor(canvasElement, "--primary-500")
    await expect(root).toHaveAttribute("aria-checked", "true")
    await expect(getComputedStyle(root).backgroundColor).toBe(primary)
    await expect(getComputedStyle(root).outlineColor).toBe(primary)
    await expect(getComputedStyle(getThumb(root)).backgroundColor).toBe(
      tokenColor(canvasElement, "--color-white"),
    )
    await expectThumbAt(root, "end")
  },
}

export const Unchecked: Story = {
  play: async ({ canvasElement }) => {
    const root = within(canvasElement).getByRole("switch")
    await expect(getComputedStyle(root).outlineColor).not.toBe(
      tokenColor(canvasElement, "--primary-500"),
    )
    await expectThumbAt(root, "start")
  },
}

export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const root = within(canvasElement).getByRole("switch")
    await userEvent.tab()
    await expect(root).toHaveFocus()
    await expect(getComputedStyle(root).boxShadow).toContain(
      tokenColor(canvasElement, "--primary-500"),
    )
    await userEvent.keyboard(" ")
    await expect(root).toHaveAttribute("aria-checked", "true")
    await userEvent.keyboard(" ")
    await expect(root).toHaveAttribute("aria-checked", "false")
    await expect(args.onCheckedChange).toHaveBeenCalledTimes(2)
  },
}

export const Small: Story = {
  args: { size: "sm" },
  render: (args) => (
    <div className="flex gap-8">
      <Switch {...args} aria-label="Off" />
      <Switch {...args} aria-label="On" defaultChecked />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const root of canvas.getAllByRole("switch")) {
      await expect(root).toHaveAttribute("data-size", "sm")
      await expect(root.getBoundingClientRect().width).toBe(22)
      await expect(root.getBoundingClientRect().height).toBe(13)
      const thumb = getThumb(root).getBoundingClientRect()
      await expect(thumb.width).toBe(10)
      await expect(thumb.height).toBe(10)
    }
    await expectThumbAt(canvas.getByRole("switch", { name: "Off" }), "start")
    await expectThumbAt(canvas.getByRole("switch", { name: "On" }), "end")
  },
}

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => (
    <div className="flex gap-8">
      <Switch {...args} aria-label="Off" />
      <Switch {...args} aria-label="On" defaultChecked />
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    for (const root of within(canvasElement).getAllByRole("switch")) {
      const checked = root.getAttribute("aria-checked")
      await expect(root).toHaveAttribute("data-disabled")
      await expect(getComputedStyle(root).opacity).toBe("0.5")
      // DOM click verifies Base UI rejects activation without relying on CSS.
      root.click()
      await expect(root).toHaveAttribute("aria-checked", checked)
    }
    await expect(args.onCheckedChange).not.toHaveBeenCalled()
  },
}
