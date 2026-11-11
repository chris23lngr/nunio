import type { Meta, StoryObj } from "@storybook/react-vite"
import { ChevronRightIcon } from "lucide-react"
import { expect, within } from "storybook/test"
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb.js"

const meta = {
  title: "Components/new/Breadcrumb",
  component: Breadcrumb,
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Breadcrumb>
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
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Plan</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("navigation", { name: "breadcrumb" }),
    ).toBeInTheDocument()

    const link = canvas.getByRole("link", { name: "Dashboard" })
    await expect(link).toHaveAttribute("href", "#dashboard")
    const linkStyle = getComputedStyle(link)
    await expect(linkStyle.color).toBe(tokenColor(canvasElement, "--base-500"))
    await expect(linkStyle.fontSize).toBe("14px")
    await expect(linkStyle.lineHeight).toBe("20px")

    const page = canvas.getByText("Plan")
    await expect(page).toHaveAttribute("aria-current", "page")
    const pageStyle = getComputedStyle(page)
    await expect(pageStyle.color).toBe(tokenColor(canvasElement, "--base-800"))
    await expect(pageStyle.fontWeight).toBe("500")

    const separator = canvas.getByText("/")
    await expect(separator).toHaveAttribute("aria-hidden", "true")
    await expect(getComputedStyle(separator).color).toBe(
      tokenColor(canvasElement, "--base-400"),
    )

    const list = canvasElement.querySelector(
      "[data-slot=breadcrumb-list]",
    ) as HTMLElement
    await expect(getComputedStyle(list).columnGap).toBe("12px")
  },
}

export const Nested: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#courses">Kurse</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Statistics II</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole("link")).toHaveLength(2)
    await expect(canvas.getAllByText("/")).toHaveLength(2)
  },
}

export const Collapsed: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Klausurvorbereitung</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvasElement }) => {
    const ellipsis = canvasElement.querySelector(
      "[data-slot=breadcrumb-ellipsis]",
    ) as HTMLElement
    await expect(ellipsis).toHaveAttribute("aria-hidden", "true")
    await expect(ellipsis.querySelector("svg")).not.toBeNull()
  },
}

export const CustomSeparator: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#dashboard">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <ChevronRightIcon />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage>Plan</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvasElement }) => {
    const separator = canvasElement.querySelector(
      "[data-slot=breadcrumb-separator]",
    ) as HTMLElement
    await expect(within(separator).queryByText("/")).toBeNull()
    const icon = separator.querySelector("svg") as SVGElement
    await expect(icon.getBoundingClientRect().width).toBe(14)
  },
}

// `render` swaps the anchor for a router link (e.g. next/link) and keeps the styles.
export const RenderAsCustomLink: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink
            render={<a href="#home" data-router-link="" />}
            className="underline"
          >
            Dashboard
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Plan</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", { name: "Dashboard" })
    await expect(link).toHaveAttribute("data-router-link")
    await expect(link).toHaveAttribute("href", "#home")
    await expect(link).toHaveClass("underline")
    await expect(link).toHaveClass("hover:text-base-800")
  },
}
