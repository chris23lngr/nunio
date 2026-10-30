import type { Meta, StoryObj } from "@storybook/react-vite"
import { Lock } from "lucide-react"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { Button } from "./button.js"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js"

const meta = {
  title: "Components/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>
export default meta

type Story = StoryObj<typeof meta>

const body = within(document.body)
const outsideClick = fn()

// Shaped like Notion's "Teilen" popover: the content brings its own padding
function SharePopover(props: React.ComponentProps<typeof Popover>) {
  return (
    <Popover {...props}>
      <PopoverTrigger render={<Button />}>
        <Lock />
        Teilen
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[456px]"
        data-testid="popup"
        aria-label="Teilen"
      >
        <div className="flex gap-2 p-4">
          <input
            className="bg-secondary-translucent h-8 flex-1 rounded-md px-2 text-sm"
            placeholder="E-Mail oder Gruppe, durch Kommas getrennt"
          />
          <Button variant="primary">Einladen</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export const Basic: Story = {
  render: () => (
    <div className="flex justify-between">
      <Button onClick={outsideClick}>Außerhalb</Button>
      <SharePopover />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("button", { name: "Teilen" })
    const outside = canvas.getByRole("button", { name: "Außerhalb" })

    // Opens on click, focusing the first field like Notion
    await userEvent.click(trigger)
    await body.findByRole("dialog", { name: "Teilen" })
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await waitFor(() =>
      expect(body.getByPlaceholderText(/E-Mail/)).toHaveFocus(),
    )

    // Escape closes and returns focus to the trigger
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await expect(trigger).toHaveFocus()

    // Modal: an outside click only closes, it never reaches what lies beneath
    await userEvent.click(trigger)
    await body.findByRole("dialog")
    const box = outside.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + 4, box.y + 4)
    if (!hit) throw new Error("nothing under the outside button")
    await expect(outside.contains(hit)).toBe(false)
    await userEvent.click(hit)
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await expect(outsideClick).not.toHaveBeenCalled()
  },
}

// Values from docs/notion-spec/components/popover.md
export const SpecStyling: Story = {
  render: () => (
    <div className="flex justify-between p-6">
      <Popover open>
        <PopoverTrigger render={<Button />}>Privat</PopoverTrigger>
        <PopoverContent data-testid="start">
          <PopoverTitle>Verschieben</PopoverTitle>
          <PopoverDescription>Seite verschieben nach…</PopoverDescription>
        </PopoverContent>
      </Popover>
      <SharePopover open />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const dark = canvasElement.closest(".dark") !== null
    const canvas = within(canvasElement)
    const style = (el: Element) => getComputedStyle(el)
    const rect = (el: Element) => el.getBoundingClientRect()
    const popup = await body.findByTestId("popup")
    await waitFor(() => expect(style(popup).opacity).toBe("1"))

    // popBac surface with shaOutLg, 12px radius, no padding of its own
    await expect(style(popup).backgroundColor).toBe(
      dark ? "rgb(37, 37, 37)" : "rgb(255, 255, 255)",
    )
    await expect(style(popup).boxShadow).toContain(
      dark ? "rgb(56, 56, 54) 0px 0px 0px 1px" : "0px 20px 24px 0px",
    )
    await expect(style(popup).borderRadius).toBe("12px")
    await expect(style(popup).padding).toBe("0px")
    await expect(style(popup).overflow).toBe("hidden")
    await expect(style(popup).minWidth).toBe("180px")
    // Never wider than the viewport minus 12px on each side
    await expect(style(popup).maxWidth).toBe(`${innerWidth - 24}px`)
    await expect(rect(popup).width).toBe(456)

    // 8px below the trigger, aligned to its end
    const share = rect(canvas.getByRole("button", { name: "Teilen" }))
    await expect(Math.round(rect(popup).top - share.bottom)).toBe(8)
    await expect(Math.round(rect(popup).right - share.right)).toBeCloseTo(0, 0)

    // Default alignment is start; a narrow popup gets the 180px minimum
    const start = body.getByTestId("start")
    const privat = rect(canvas.getByRole("button", { name: "Privat" }))
    await expect(Math.round(rect(start).left - privat.left)).toBeCloseTo(0, 0)
    await expect(Math.round(rect(start).top - privat.bottom)).toBe(8)
    await expect(rect(start).width).toBeGreaterThanOrEqual(180)
    await expect(body.getByRole("dialog", { name: "Verschieben" })).toBe(start)
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
