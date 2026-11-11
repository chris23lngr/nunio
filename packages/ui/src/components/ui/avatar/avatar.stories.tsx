import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import { Avatar, AvatarFallback, AvatarImage } from "./avatar.js"

const meta = {
  title: "Components/new/Avatar",
  component: Avatar,
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Avatar>
export default meta

type Story = StoryObj<typeof meta>

const photo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#0ea5e9"/></svg>',
)}`

function tokenColor(canvas: HTMLElement, token: string) {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  canvas.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

export const Initials: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>JS</AvatarFallback>
    </Avatar>
  ),
  play: async ({ canvasElement }) => {
    const fallback = await within(canvasElement).findByText("JS")
    const root = fallback.closest("[data-slot=avatar]") as HTMLElement
    const rect = root.getBoundingClientRect()
    await expect(rect.width).toBe(24)
    await expect(rect.height).toBe(24)
    await expect(getComputedStyle(root).borderRadius).toBe("6px")
    const style = getComputedStyle(fallback)
    await expect(style.backgroundColor).toBe(
      tokenColor(canvasElement, "--primary-100"),
    )
    await expect(style.borderRadius).toBe("6px")
    await expect(style.color).toBe(tokenColor(canvasElement, "--primary-600"))
    await expect(style.fontSize).toBe("12px")
    await expect(style.lineHeight).toBe("16px")
    await expect(style.fontWeight).toBe("500")
    await expect(style.display).toBe("flex")
    await expect(style.alignItems).toBe("center")
    await expect(style.justifyContent).toBe("center")
  },
}

export const WithImage: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src={photo} alt="Jane Smith" />
      <AvatarFallback>JS</AvatarFallback>
    </Avatar>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const image = await canvas.findByRole("img", { name: "Jane Smith" })
    await expect(canvas.queryByText("JS")).not.toBeInTheDocument()
    const rect = image.getBoundingClientRect()
    await expect(rect.width).toBe(24)
    await expect(rect.height).toBe(24)
    const style = getComputedStyle(image)
    await expect(style.objectFit).toBe("cover")
    await expect(style.borderRadius).toBe("6px")
  },
}

export const BrokenImage: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src="/does-not-exist.png" alt="Jane Smith" />
      <AvatarFallback>JS</AvatarFallback>
    </Avatar>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("JS")).toBeVisible()
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument()
  },
}
