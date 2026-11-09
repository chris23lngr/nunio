import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  BookIcon,
  CalendarIcon,
  CircleDashedCheckIcon,
  FolderIcon,
  LifeBuoyIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
  TargetIcon,
} from "lucide-react"
import { useState } from "react"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "./sidebar.js"

const navigation = [
  { label: "Heute", icon: SunIcon, href: "#heute" },
  { label: "Plan", icon: CalendarIcon, href: "#plan" },
  { label: "Kurse", icon: BookIcon, href: "#kurse" },
  { label: "Projekte", icon: FolderIcon, href: "#projekte" },
  { label: "Aufgaben", icon: CircleDashedCheckIcon, href: "#aufgaben" },
]
const courses = [
  {
    name: "Algorithms and Data Structures for Computer Science",
    color: "bg-rose-500",
  },
  { name: "Statistics II", color: "bg-fuchsia-500" },
  { name: "Microeconomics", color: "bg-purple-500" },
]

function DemoContent({ manyCourses = false }: { manyCourses?: boolean }) {
  return (
    <>
      <SidebarHeader>
        <div className="flex h-9 min-w-0 items-center justify-between gap-4">
          <span className="text-base-500 truncate text-sm group-data-[collapsible=icon]:hidden">
            Header placeholder
          </span>
          <SidebarTrigger />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map(({ label, icon: Icon, href }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<a href={href} />}
                    isActive={label === "Kurse"}
                    aria-current={label === "Kurse" ? "page" : undefined}
                    tooltip={label}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Kurse</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {Array.from({ length: manyCourses ? 20 : 1 }, (_, i) =>
                courses.map(({ name, color }, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Static overflow fixtures never reorder.
                  <SidebarMenuItem key={`${i}-${name}`}>
                    <SidebarMenuButton
                      render={<a href={`#course-${i}-${j}`} />}
                    >
                      <span
                        className="flex size-4 shrink-0 items-center"
                        aria-hidden="true"
                      >
                        <span className={`size-3 rounded-sm ${color}`} />
                      </span>
                      <span>{name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<a href="#statistics-exam" />}>
                  <TargetIcon />
                  <span>Statistics exam prep</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<a href="#help" />}>
              <LifeBuoyIcon />
              <span>Help Center</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton render={<a href="#settings" />}>
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  )
}

function MainContent() {
  return (
    <SidebarInset>
      <header className="text-base-500 flex h-16 shrink-0 items-center gap-3 px-4 text-sm">
        <SidebarTrigger data-testid="outside-trigger" />
        <span>Content placeholder</span>
      </header>
    </SidebarInset>
  )
}

function Demo({
  manyCourses = false,
  ...args
}: React.ComponentProps<typeof Sidebar> & { manyCourses?: boolean }) {
  return (
    <SidebarProvider>
      <Sidebar {...args}>
        <DemoContent manyCourses={manyCourses} />
      </Sidebar>
      <MainContent />
    </SidebarProvider>
  )
}

const meta = {
  title: "Components/new/Sidebar",
  component: Sidebar,
  parameters: { layout: "fullscreen" },
  args: { side: "left", variant: "sidebar", collapsible: "offcanvas" },
  render: (args) => <Demo {...args} />,
} satisfies Meta<typeof Sidebar>
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

function slot(canvas: HTMLElement, name: string) {
  const element = canvas.querySelector<HTMLElement>(`[data-slot="${name}"]`)
  if (!element) throw new Error(`Missing ${name}`)
  return element
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sidebar = slot(canvasElement, "sidebar-inner")
    await expect(sidebar.getBoundingClientRect().width).toBe(320)
    await expect(sidebar.getBoundingClientRect().height).toBe(
      window.innerHeight,
    )
    await expect(getComputedStyle(sidebar).backgroundColor).toBe(
      tokenColor(canvasElement, "--base-50"),
    )
    const row = canvas.getByRole("link", { name: "Heute" })
    const style = getComputedStyle(row)
    await expect(row.getBoundingClientRect().height).toBe(32)
    await expect(row.getBoundingClientRect().width).toBe(304)
    await expect(style.borderRadius).toBe("8px")
    await expect(style.fontSize).toBe("14px")
    await expect(style.lineHeight).toBe("18px")
    await expect(style.fontWeight).toBe("500")
    await expect(style.padding).toBe("6px 10px")
    await expect(style.color).toBe(tokenColor(canvasElement, "--base-800"))
    await expect(row.querySelector("svg")?.getBoundingClientRect().width).toBe(
      16,
    )
    for (const item of canvas.getAllByRole("link")) {
      await expect(item.getBoundingClientRect().height).toBe(32)
      await expect(item.getBoundingClientRect().width).toBe(304)
      await expect(item.getBoundingClientRect().left).toBe(8)
      await expect(getComputedStyle(item).fontSize).toBe("14px")
      await expect(getComputedStyle(item).lineHeight).toBe("18px")
    }
    const headerStyle = getComputedStyle(slot(canvasElement, "sidebar-header"))
    await expect(headerStyle.paddingLeft).toBe("12px")
    await expect(headerStyle.paddingRight).toBe("18px")
    for (const name of ["sidebar-content", "sidebar-footer"]) {
      const gutter = getComputedStyle(slot(canvasElement, name))
      await expect(gutter.paddingLeft).toBe("8px")
      await expect(gutter.paddingRight).toBe("8px")
    }
    for (const menu of slot(canvasElement, "sidebar-content").querySelectorAll(
      '[data-slot="sidebar-menu"]',
    )) {
      await expect(getComputedStyle(menu).rowGap).toBe("4px")
    }
    const footer = slot(canvasElement, "sidebar-footer")
    await expect(getComputedStyle(footer).rowGap).toBe("4px")
    const footerMenu = footer.querySelector('[data-slot="sidebar-menu"]')
    if (!footerMenu) throw new Error("Missing footer menu")
    await expect(getComputedStyle(footerMenu).rowGap).toBe("6px")
    const label = canvas.getByText("Projects")
    await expect(getComputedStyle(label).fontSize).toBe("12px")
    await expect(getComputedStyle(label).color).toBe(
      tokenColor(canvasElement, "--base-500"),
    )
    const title = canvas.getByText(
      "Algorithms and Data Structures for Computer Science",
    )
    await expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
    await expect(getComputedStyle(title).textOverflow).toBe("ellipsis")
    await expect(
      canvas.queryByText("Justus Schuhmacher"),
    ).not.toBeInTheDocument()
  },
}

export const InteractionStates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const current = canvas.getByRole("link", { name: "Kurse" })
    const plan = canvas.getByRole("link", { name: "Plan" })
    const blue = tokenColor(canvasElement, "--primary-600")
    await expect(current).toHaveAttribute("aria-current", "page")
    await expect(getComputedStyle(current).color).toBe(blue)
    await expect(
      getComputedStyle(current.querySelector("svg") as SVGElement).color,
    ).toBe(tokenColor(canvasElement, "--primary-500"))
    // Native browser actions exercise CSS :hover, unlike synthetic DOM events.
    if (import.meta.env.MODE === "test") {
      const { userEvent: browser } = await import("vitest/browser")
      await browser.hover(current)
      await expect(getComputedStyle(current).color).toBe(blue)
      await expect(getComputedStyle(current).backgroundColor).toBe(
        tokenColor(canvasElement, "--base-100"),
      )
      await browser.hover(plan)
      await expect(getComputedStyle(plan).backgroundColor).toBe(
        tokenColor(canvasElement, "--base-100"),
      )
    }
    await userEvent.tab()
    plan.focus()
    await expect(plan.matches(":focus-visible")).toBe(true)
    const style = getComputedStyle(plan)
    await expect(style.boxShadow).toContain(
      tokenColor(canvasElement, "--primary-500"),
    )
    await expect(style.boxShadow).toContain(
      tokenColor(canvasElement, "--color-white"),
    )
    await expect(style.getPropertyValue("--tw-ring-offset-width")).toBe("4px")
  },
}

export const Offcanvas: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sidebar = slot(canvasElement, "sidebar")
    const gap = slot(canvasElement, "sidebar-gap")
    const panel = slot(canvasElement, "sidebar-container")
    await userEvent.click(canvas.getByTestId("outside-trigger"))
    await expect(sidebar).toHaveAttribute("data-state", "collapsed")
    await waitFor(() => expect(gap.getBoundingClientRect().width).toBe(0))
    await waitFor(() =>
      expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(0),
    )
    await expect(document.cookie).toContain("sidebar_state=false")
    await userEvent.keyboard("{Control>}b{/Control}")
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
    await waitFor(() => expect(gap.getBoundingClientRect().width).toBe(320))
    await expect(document.cookie).toContain("sidebar_state=true")
    await userEvent.keyboard("{Meta>}b{/Meta}")
    await expect(sidebar).toHaveAttribute("data-state", "collapsed")
    await userEvent.click(canvas.getByTestId("outside-trigger"))
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
  },
}

// Run at a narrow viewport to exercise the template's mobile Sheet branch.
export const Responsive: Story = {
  play: async ({ canvasElement }) => {
    if (window.innerWidth >= 768) {
      await expect(slot(canvasElement, "sidebar")).toHaveAttribute(
        "data-state",
        "expanded",
      )
      return
    }
    const canvas = within(canvasElement)
    const body = within(document.body)
    const trigger = canvas.getByTestId("outside-trigger")
    await userEvent.click(trigger)
    const drawer = await body.findByRole("dialog", { name: "Sidebar" })
    await expect(drawer).toHaveAttribute("data-mobile", "true")
    await expect(getComputedStyle(drawer).backgroundColor).toBe(
      tokenColor(canvasElement, "--base-50"),
    )
    await waitFor(() => expect(drawer.getBoundingClientRect().width).toBe(288))
    const firstLink = within(drawer).getByRole("link", { name: "Heute" })
    await expect(firstLink.getBoundingClientRect().height).toBe(32)
    await expect(firstLink.getBoundingClientRect().width).toBe(272)
    await expect(getComputedStyle(firstLink).fontSize).toBe("14px")
    await expect(getComputedStyle(firstLink).lineHeight).toBe("18px")
    firstLink.focus()
    await userEvent.tab({ shift: true })
    await expect(drawer.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(body.queryByRole("dialog")).not.toBeInTheDocument(),
    )
    await expect(trigger).toHaveFocus()
    await userEvent.keyboard("{Control>}b{/Control}")
    await expect(
      await body.findByRole("dialog", { name: "Sidebar" }),
    ).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(body.queryByRole("dialog")).not.toBeInTheDocument(),
    )
  },
}

export const Overflow: Story = {
  render: (args) => <Demo {...args} manyCourses />,
  play: async ({ canvasElement }) => {
    const content = slot(canvasElement, "sidebar-content")
    const footer = slot(canvasElement, "sidebar-footer")
    const header = slot(canvasElement, "sidebar-header")
    await expect(content.scrollHeight).toBeGreaterThan(content.clientHeight)
    const footerTop = footer.getBoundingClientRect().top
    const headerTop = header.getBoundingClientRect().top
    content.scrollTop = content.scrollHeight
    await expect(content.scrollTop).toBeGreaterThan(0)
    await expect(footer.getBoundingClientRect().top).toBe(footerTop)
    await expect(header.getBoundingClientRect().top).toBe(headerTop)
    await expect(footer.getBoundingClientRect().bottom).toBe(
      window.innerHeight - 32,
    )
  },
}

function ControlledDemo({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <SidebarProvider
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        onOpenChange(value)
      }}
    >
      <Sidebar>
        <DemoContent />
      </Sidebar>
      <MainContent />
    </SidebarProvider>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo onOpenChange={onOpenChange} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("outside-trigger"))
    await expect(onOpenChange).toHaveBeenCalledWith(false)
    await expect(slot(canvasElement, "sidebar")).toHaveAttribute(
      "data-state",
      "collapsed",
    )
  },
}
const onOpenChange = fn()

export const TemplateHelpers: Story = {
  render: () => (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarInput aria-label="Search" placeholder="Search" />
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Group</SidebarGroupLabel>
            <SidebarGroupAction aria-label="Add">
              <PlusIcon />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <BookIcon />
                    <span>Course</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction showOnHover aria-label="More">
                    <MoreHorizontalIcon />
                  </SidebarMenuAction>
                  <SidebarMenuBadge>3</SidebarMenuBadge>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton href="#nested">
                        Nested page
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>Unavailable</SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              <SidebarMenuSkeleton showIcon />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <MainContent />
    </SidebarProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const disabled = canvas.getByRole("button", { name: "Unavailable" })
    await expect(disabled).toBeDisabled()
    await expect(getComputedStyle(disabled).opacity).toBe("0.5")
    const course = canvas.getByRole("button", { name: "Course" })
    const more = canvas.getByRole("button", { name: "More" })
    if (import.meta.env.MODE === "test") {
      const { userEvent: browser } = await import("vitest/browser")
      await browser.hover(canvas.getByTestId("outside-trigger"))
    }
    await expect(getComputedStyle(more).opacity).toBe("0")
    course.focus()
    await expect(getComputedStyle(more).opacity).toBe("1")
    for (const control of [more, slot(canvasElement, "sidebar-menu-badge")]) {
      const rowBox = course.getBoundingClientRect()
      const controlBox = control.getBoundingClientRect()
      await expect(controlBox.top + controlBox.height / 2).toBe(
        rowBox.top + rowBox.height / 2,
      )
    }
    await expect(
      slot(canvasElement, "sidebar-menu-skeleton").getBoundingClientRect()
        .height,
    ).toBe(32)
    const search = canvas.getByRole("textbox", { name: "Search" })
    await userEvent.type(search, "Algorithms")
    await expect(search).toHaveValue("Algorithms")
    await expect(
      canvas.getByRole("link", { name: "Nested page" }),
    ).toBeVisible()
  },
}
