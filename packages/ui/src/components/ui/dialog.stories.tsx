import type { Meta, StoryObj } from "@storybook/react-vite"
import { Search } from "lucide-react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "./button.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js"

const meta = {
  title: "Components/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>
export default meta

type Story = StoryObj<typeof meta>

const body = within(document.body)

// Shaped like Notion's Settings modal: sized by the surface, content brings its
// own padding and scrolls inside
function SettingsDialog(props: React.ComponentProps<typeof Dialog>) {
  return (
    <Dialog {...props}>
      <DialogTrigger render={<Button />}>Einstellungen</DialogTrigger>
      <DialogContent
        className="flex h-[calc(100%-100px)] w-[90vw] max-w-[1512px]"
        data-testid="popup"
      >
        <nav className="bg-sidebar w-60 shrink-0 p-2">
          <label className="bg-secondary-translucent flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm">
            <Search className="text-icon-tertiary size-4" />
            <input
              className="flex-1 outline-hidden"
              placeholder="Einstellungen durchsuchen"
            />
          </label>
        </nav>
        <div className="flex-1 overflow-y-auto px-16 py-9">
          <DialogTitle className="text-2xl font-semibold">
            Meine Einstellungen
          </DialogTitle>
          <DialogDescription className="text-secondary mt-1 text-sm">
            Lege fest, wie Notion aussehen und sich verhalten soll
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export const Basic: Story = {
  render: () => <SettingsDialog />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("button", { name: "Einstellungen" })

    // Opens named by its title, focusing the first field like Notion
    await userEvent.click(trigger)
    await body.findByRole("dialog", { name: "Meine Einstellungen" })
    await waitFor(() =>
      expect(body.getByPlaceholderText(/durchsuchen/)).toHaveFocus(),
    )

    // Escape closes and returns focus to the trigger
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await expect(trigger).toHaveFocus()

    // A click on the dimmed backdrop, beside the popup, closes
    await userEvent.click(trigger)
    const popup = await body.findByRole("dialog")
    const box = popup.getBoundingClientRect()
    const beside = document.elementFromPoint(box.left / 2, box.top + 20)
    if (!beside) throw new Error("nothing beside the dialog")
    await expect(popup.contains(beside)).toBe(false)
    await userEvent.click(beside)
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())

    // So does the close button
    await userEvent.click(trigger)
    await userEvent.click(await body.findByRole("button", { name: "Close" }))
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
  },
}

// Values from docs/notion-spec/components/dialog.md
export const SpecStyling: Story = {
  render: () => <SettingsDialog open />,
  play: async () => {
    const dark = document.documentElement.classList.contains("dark")
    const style = (el: Element) => getComputedStyle(el)
    const rect = (el: Element) => el.getBoundingClientRect()
    const popup = await body.findByTestId("popup")
    await waitFor(() => expect(style(popup).opacity).toBe("1"))
    await waitFor(() =>
      expect(style(popup).transform).toMatch(/^(none|matrix\(1, 0, 0, 1,)/),
    )

    // bacEle surface with shaOutScr, 12px radius, no padding of its own
    await expect(style(popup).backgroundColor).toBe(
      dark ? "rgb(32, 32, 32)" : "rgb(255, 255, 255)",
    )
    await expect(style(popup).boxShadow).toContain(
      dark ? "rgb(56, 56, 54) 0px 0px 0px 1px" : "0px 24px 48px 0px",
    )
    await expect(style(popup).borderRadius).toBe("12px")
    await expect(style(popup).padding).toBe("0px")
    await expect(style(popup).overflow).toBe("hidden")

    // Centered in the viewport, 50px above and below
    const box = rect(popup)
    await expect(Math.round(box.top)).toBe(50)
    await expect(Math.round(innerHeight - box.bottom)).toBe(50)
    await expect(Math.round(box.left - (innerWidth - box.right))).toBeCloseTo(
      0,
      0,
    )

    // modUndBac backdrop: 60% black in light, 80% in dark
    const backdrop = document.querySelector("[data-slot=dialog-backdrop]")
    if (!backdrop) throw new Error("backdrop not found")
    await waitFor(() => expect(style(backdrop).opacity).toBe("1"))
    await expect(style(backdrop).backgroundColor).toBe(
      dark ? "rgba(15, 15, 15, 0.8)" : "rgba(15, 15, 15, 0.6)",
    )

    // Round 22px close button, 12px from the top-right corner, 14px icon
    const close = body.getByRole("button", { name: "Close" })
    await expect(rect(close).width).toBe(22)
    await expect(rect(close).height).toBe(22)
    await expect(Math.round(rect(close).top - box.top)).toBe(12)
    await expect(Math.round(box.right - rect(close).right)).toBe(12)
    const icon = close.querySelector("svg")
    if (!icon) throw new Error("close button has no icon")
    await expect(rect(icon).width).toBe(14)
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
