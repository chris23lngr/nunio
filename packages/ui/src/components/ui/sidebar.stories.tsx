import { Collapsible } from "@base-ui/react/collapsible"
import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  ChevronDown,
  FileText,
  House,
  Library,
  MoreHorizontal,
  Plus,
  Settings2,
} from "lucide-react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "./sidebar.js"

const meta = {
  title: "Components/Sidebar",
  component: SidebarProvider,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SidebarProvider>
export default meta

type Story = StoryObj<typeof meta>

const PAGES = ["nui sandbox page", "Pilotkunden Akquise", "Operations Research"]

// Notion's desktop sidebar beside a page
function NotionSidebar(props: React.ComponentProps<typeof SidebarProvider>) {
  return (
    <SidebarProvider className="h-[693px]" {...props}>
      <Sidebar data-testid="sidebar">
        <SidebarHeader className="h-11 flex-row items-center gap-1 px-3">
          <span className="flex-1" />
          <SidebarTrigger aria-label="Seitenleiste schließen" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton data-testid="home">
                <House />
                <span>Home</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <Library />
                <span>Bibliothek</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Collapsible.Root defaultOpen>
            <SidebarGroup>
              <SidebarGroupLabel
                render={<Collapsible.Trigger />}
                data-testid="section"
              >
                Privat
                <ChevronDown />
              </SidebarGroupLabel>
              <SidebarGroupAction aria-label="Seite hinzufügen">
                <Plus />
              </SidebarGroupAction>
              <Collapsible.Panel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {PAGES.map((page, index) => (
                      <SidebarMenuItem key={page}>
                        <SidebarMenuButton
                          render={<a href={`#${index}`} />}
                          isActive={index === 0}
                          aria-current={index === 0 ? "page" : undefined}
                          data-testid={
                            index === 0 ? "current" : `page-${index}`
                          }
                        >
                          <FileText className="text-sidebar" />
                          <span>{page}</span>
                        </SidebarMenuButton>
                        <SidebarMenuAction showOnHover aria-label="Mehr">
                          <MoreHorizontal />
                        </SidebarMenuAction>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </Collapsible.Panel>
            </SidebarGroup>
          </Collapsible.Root>
          <SidebarMenu className="mt-auto pb-2">
            <SidebarMenuItem>
              <SidebarMenuButton variant="muted" data-testid="muted">
                <Settings2 />
                <span>Seitenleiste anpassen</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="h-11" data-testid="footer" />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-11 items-center px-3">
          <SidebarTrigger aria-label="Seitenleiste öffnen" />
        </header>
        <h1 className="px-24 text-[40px] font-bold">nui sandbox page</h1>
      </SidebarInset>
    </SidebarProvider>
  )
}

export const Basic: Story = {
  render: () => <NotionSidebar />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sidebar = canvas.getByTestId("sidebar")
    const nav = canvas.getByRole("navigation")
    await expect(sidebar).toHaveAttribute("data-state", "expanded")

    // The current page is marked for assistive tech and styling
    const current = canvas.getByRole("link", { name: "nui sandbox page" })
    await expect(current).toHaveAttribute("aria-current", "page")
    await expect(current).toHaveAttribute("data-active")

    // Sections toggle their pages and keep focus on the header
    const section = canvas.getByRole("button", { name: /Privat/ })
    await expect(section).toHaveAttribute("aria-expanded", "true")
    await userEvent.click(section)
    await expect(section).toHaveAttribute("aria-expanded", "false")
    await expect(canvas.queryByRole("link", { name: "nui sandbox page" })).toBe(
      null,
    )
    await expect(section).toHaveFocus()
    await userEvent.click(section)
    await expect(canvas.getByRole("link", { name: "nui sandbox page" })).toBe(
      canvas.getByTestId("current"),
    )

    // Closing slides the sidebar out and takes it out of the tab order
    await userEvent.click(
      canvas.getByRole("button", { name: "Seitenleiste schließen" }),
    )
    await expect(sidebar).toHaveAttribute("data-state", "collapsed")
    await waitFor(() => expect(sidebar.getBoundingClientRect().width).toBe(0))
    await expect(nav).toHaveAttribute("inert")
    // Focus moves to the opener rather than being lost with the panel
    const opener = canvas.getByRole("button", { name: "Seitenleiste öffnen" })
    await expect(opener).toHaveFocus()

    // ⌘B / Ctrl+B toggles it back
    await userEvent.keyboard("{Control>}b{/Control}")
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
    await waitFor(() => expect(sidebar.getBoundingClientRect().width).toBe(270))
    await expect(nav).not.toHaveAttribute("inert")
  },
}

const TRANSPARENT = "rgba(0, 0, 0, 0)"
// Blue layer of the focus-button shadow (Notion butBluFocRin)
const FOCUS_RING_BLUE = "rgb(35, 131, 226)"

// Values from docs/notion-spec/components/sidebar.md
export const SpecStyling: Story = {
  render: () => <NotionSidebar />,
  play: async ({ canvasElement }) => {
    const dark = document.documentElement.classList.contains("dark")
    const canvas = within(canvasElement)
    const style = (el: Element) => getComputedStyle(el)
    const rect = (el: Element) => el.getBoundingClientRect()
    const nav = canvas.getByRole("navigation")

    // 270px bacSec shell with a 1px borSec inset divider on its trailing edge
    await expect(rect(canvas.getByTestId("sidebar")).width).toBe(270)
    await expect(style(nav).backgroundColor).toBe(
      dark ? "rgb(32, 32, 32)" : "rgb(249, 248, 247)",
    )
    // Tailwind prefixes empty ring layers; the divider is the inset layer
    await expect(style(nav).boxShadow).toContain(
      `${dark ? "rgb(44, 44, 43)" : "rgb(240, 239, 237)"} -1px 0px 0px 0px inset`,
    )

    // 254px rows inside 8px gutters, 30px high, 14/21 regular
    const page = canvas.getByTestId("page-1")
    await expect(rect(page).height).toBe(30)
    await expect(rect(page.parentElement as Element).width).toBe(254)
    await expect(style(page).padding).toBe("5px 8px")
    await expect(style(page).fontSize).toBe("14px")
    await expect(style(page).lineHeight).toBe("21px")
    await expect(style(page).fontWeight).toBe("400")
    await expect(style(page).borderRadius).toBe("6px")

    // Idle label texAccPri on no fill; the current page texPri on bacIntTra
    await expect(style(page).color).toBe(
      dark ? "rgb(188, 186, 182)" : "rgb(95, 94, 89)",
    )
    await expect(style(page).backgroundColor).toBe(TRANSPARENT)
    const current = canvas.getByTestId("current")
    await expect(style(current).color).toBe(
      dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)",
    )
    await expect(style(current).backgroundColor).not.toBe(TRANSPARENT)

    // Page icons: 18px in a 22px slot, 8px before the label, sidSecCol
    const icon = page.querySelector("svg")
    if (!icon) throw new Error("page has no icon")
    await expect(rect(icon).width).toBe(18)
    const label = page.querySelector("span")
    if (!label) throw new Error("page has no label")
    await expect(Math.round(rect(label).left - rect(page).left)).toBe(
      8 + 22 + 8,
    )
    await expect(style(icon).color).toBe(
      dark ? "rgb(155, 155, 155)" : "rgb(145, 145, 142)",
    )

    // Row actions stay hidden until the row is hovered or focused
    const action = within(page.parentElement as HTMLElement).getByRole(
      "button",
      { name: "Mehr" },
    )
    await expect(rect(action).width).toBe(20)
    await expect(style(action).opacity).toBe("0")

    // Section header: 12/16 medium texTer, chevron hidden until hover/focus
    const section = canvas.getByTestId("section")
    await expect(rect(section).height).toBe(30)
    await expect(style(section).fontSize).toBe("12px")
    await expect(style(section).fontWeight).toBe("500")
    await expect(style(section).color).toBe(
      dark ? "rgb(125, 122, 117)" : "rgb(161, 158, 153)",
    )
    const chevron = section.querySelector("svg")
    if (!chevron) throw new Error("section has no chevron")
    await expect(style(chevron).opacity).toBe("0")

    // Muted rows: texTer label
    await expect(style(canvas.getByTestId("muted")).color).toBe(
      style(section).color,
    )

    // Footer stays outside the scroll region at the bottom
    await expect(rect(canvas.getByTestId("footer")).bottom).toBe(
      rect(nav).bottom,
    )

    // Keyboard focus on a row: button ring, its actions revealed
    page.focus()
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}")
    await userEvent.tab()
    await expect(page).toHaveFocus()
    await expect(style(page).boxShadow).toContain(FOCUS_RING_BLUE)
    await waitFor(() => expect(style(action).opacity).toBe("1"))
    await expect(style(page).paddingRight).toBe("32px")
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
