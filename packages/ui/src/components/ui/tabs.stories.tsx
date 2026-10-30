import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Calendar,
  Clock,
  House,
  MessageCircle,
  Star,
  Users,
} from "lucide-react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Tabs, TabsList, TabsPanel, TabsTab } from "./tabs.js"

const meta = {
  title: "Components/Tabs",
  component: Tabs,
} satisfies Meta<typeof Tabs>
export default meta

type Story = StoryObj<typeof meta>

const style = (el: Element) => getComputedStyle(el)
const rect = (el: Element) => el.getBoundingClientRect()
const TRANSPARENT = "rgba(0, 0, 0, 0)"
// Blue layer of the focus-button shadow (Notion butBluFocRin)
const FOCUS_RING_BLUE = "rgb(35, 131, 226)"

// Notion's Library view tabs
function ViewTabs() {
  return (
    <Tabs defaultValue="recents">
      <TabsList data-testid="list">
        <TabsTab value="recents" icon={<Clock />} data-testid="recents">
          Kürzlich verwendet
        </TabsTab>
        <TabsTab value="favorites" icon={<Star />} data-testid="favorites">
          Favoriten
        </TabsTab>
        <TabsTab value="shared" icon={<Users />}>
          Geteilt
        </TabsTab>
      </TabsList>
      <TabsPanel value="recents">Zuletzt besuchte Seiten</TabsPanel>
      <TabsPanel value="favorites">Deine Favoriten</TabsPanel>
      <TabsPanel value="shared">Mit dir geteilt</TabsPanel>
    </Tabs>
  )
}

export const Basic: Story = {
  render: () => <ViewTabs />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const recents = canvas.getByRole("tab", { name: "Kürzlich verwendet" })
    const favorites = canvas.getByRole("tab", { name: "Favoriten" })
    await expect(recents).toHaveAttribute("aria-selected", "true")
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent(
      "Zuletzt besuchte Seiten",
    )

    // A click activates the view and keeps focus on the tab
    await userEvent.click(favorites)
    await expect(favorites).toHaveAttribute("aria-selected", "true")
    // The old panel stays mounted for a frame with data-ending-style
    await waitFor(() =>
      expect(canvas.getByRole("tabpanel")).toHaveTextContent("Deine Favoriten"),
    )
    await expect(favorites).toHaveFocus()

    // Arrow keys move focus only; Enter activates (Base UI's manual default)
    await userEvent.keyboard("{ArrowRight}")
    const shared = canvas.getByRole("tab", { name: "Geteilt" })
    await expect(shared).toHaveFocus()
    await expect(favorites).toHaveAttribute("aria-selected", "true")
    await userEvent.keyboard("{Enter}")
    await expect(shared).toHaveAttribute("aria-selected", "true")
  },
}

// Values from docs/notion-spec/components/tabs.md
export const SpecStyling: Story = {
  render: () => <ViewTabs />,
  play: async ({ canvasElement }) => {
    const dark = document.documentElement.classList.contains("dark")
    const canvas = within(canvasElement)
    const active = canvas.getByTestId("recents")
    const inactive = canvas.getByTestId("favorites")

    // 40px strip of 32px pills with a 1px gap
    await expect(rect(canvas.getByTestId("list")).height).toBe(40)
    await expect(style(canvas.getByTestId("list")).columnGap).toBe("1px")
    await expect(rect(active).height).toBe(32)
    await expect(style(active).padding).toBe("6px 12px")
    await expect(style(active).borderRadius).toBe("20px")
    await expect(style(active).maxWidth).toBe("220px")
    await expect(style(active).fontSize).toBe("14px")
    await expect(style(inactive).fontWeight).toBe("500")

    // Active: bacIntTra fill and texPri; inactive: transparent and texSec
    await waitFor(() =>
      expect(style(active).backgroundColor).not.toBe(TRANSPARENT),
    )
    await expect(style(active).color).toBe(
      dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)",
    )
    await expect(style(inactive).backgroundColor).toBe(TRANSPARENT)
    await expect(style(inactive).color).toBe(
      dark ? "rgb(173, 169, 163)" : "rgb(125, 122, 117)",
    )

    // 20px icon in the label's color, 6px before the label
    const icon = inactive.querySelector("svg")
    if (!icon) throw new Error("tab has no icon")
    await expect(rect(icon).width).toBe(20)
    await expect(style(icon).marginRight).toBe("6px")
    await expect(style(icon).color).toBe(style(inactive).color)

    // Keyboard focus rings the tab like a button
    await userEvent.tab()
    await expect(active).toHaveFocus()
    await expect(style(active).boxShadow).toContain(FOCUS_RING_BLUE)
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}

// Notion's Home / Chat / Meetings: icon-only until active, then the label
// slides open
export const Sidebar: Story = {
  render: () => (
    <Tabs defaultValue="home">
      <TabsList variant="sidebar">
        <TabsTab value="home" icon={<House />} data-testid="home">
          Home
        </TabsTab>
        <TabsTab value="chat" icon={<MessageCircle />} data-testid="chat">
          Chat
        </TabsTab>
        <TabsTab value="meetings" icon={<Calendar />}>
          Meetings
        </TabsTab>
      </TabsList>
      <TabsPanel value="home">Home</TabsPanel>
      <TabsPanel value="chat">Chat</TabsPanel>
      <TabsPanel value="meetings">Meetings</TabsPanel>
    </Tabs>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const home = canvas.getByTestId("home")
    const chat = canvas.getByTestId("chat")
    const frame = (tab: HTMLElement) => {
      const el = tab.querySelector("[data-slot=tabs-tab-icon]")
      if (!el) throw new Error("tab has no icon frame")
      return el
    }

    // Inactive: 32px square, icon at half opacity, label collapsed but named
    await expect(rect(chat).width).toBe(32)
    await expect(rect(chat).height).toBe(32)
    await expect(style(chat).borderRadius).toBe("8px")
    await expect(style(frame(chat)).opacity).toBe("0.5")
    await expect(chat).toHaveAccessibleName("Chat")

    // Active: wider than the square, full-opacity icon
    await expect(rect(home).width).toBeGreaterThan(32)
    await expect(style(frame(home)).opacity).toBe("1")

    // Activating Chat opens its label and collapses Home's
    await userEvent.click(chat)
    await waitFor(() => expect(rect(chat).width).toBeGreaterThan(32))
    await waitFor(() => expect(rect(home).width).toBe(32))
    await expect(style(frame(chat)).opacity).toBe("1")
  },
}
