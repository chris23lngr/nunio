import type { Meta, StoryObj } from "@storybook/react-vite"
import { Link, Sparkles, Star } from "lucide-react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "./button.js"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipShortcut,
  TooltipTrigger,
} from "./tooltip.js"

const meta = {
  title: "Components/Tooltip",
  component: Tooltip,
} satisfies Meta<typeof Tooltip>
export default meta

type Story = StoryObj<typeof meta>

const body = within(document.body)

// Time from pointer entry until the tooltip is in the document
async function openDelay(trigger: HTMLElement, text: string) {
  const start = performance.now()
  await userEvent.hover(trigger)
  await body.findByText(text, undefined, { timeout: 2000 })
  return performance.now() - start
}

export const Basic: Story = {
  render: () => (
    <div className="flex gap-1">
      <Tooltip>
        <TooltipTrigger
          render={<Button size="icon" aria-label="Link kopieren" />}
        >
          <Link />
        </TooltipTrigger>
        <TooltipContent>Link kopieren</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button size="icon" aria-label="Favorit" />}>
          <Star />
        </TooltipTrigger>
        <TooltipContent>Zu deinen Favoriten hinzufügen</TooltipContent>
      </Tooltip>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole("button", { name: "Link kopieren" })

    // Notion opens after ~180ms: not instantly, well before Base UI's 600ms default
    const delay = await openDelay(link, "Link kopieren")
    await expect(delay).toBeGreaterThan(150)
    await expect(delay).toBeLessThan(400)

    // Pointer can pass over the popup without keeping it open
    const popup = body.getByText("Link kopieren").closest("[data-slot]")
    if (!popup) throw new Error("tooltip popup not found")
    await expect(getComputedStyle(popup).pointerEvents).toBe("none")

    // Leaving closes it: no close delay, a 50ms fade, then unmount
    await userEvent.unhover(link)
    await waitFor(() => expect(body.queryByText("Link kopieren")).toBeNull(), {
      timeout: 300,
    })

    // Keyboard focus opens it too
    await userEvent.keyboard("{Escape}")
    link.focus()
    await body.findByText("Link kopieren")
    link.blur()
    await waitFor(() => expect(body.queryByText("Link kopieren")).toBeNull())
  },
}

// Apps often wrap everything in a provider; Notion still has no "warm" instant
// open when moving between neighbours
export const NoWarmOpen: Story = {
  render: (args, context) => (
    <TooltipProvider>{Basic.render?.(args, context)}</TooltipProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openDelay(
      canvas.getByRole("button", { name: "Link kopieren" }),
      "Link kopieren",
    )
    const delay = await openDelay(
      canvas.getByRole("button", { name: "Favorit" }),
      "Zu deinen Favoriten hinzufügen",
    )
    await expect(delay).toBeGreaterThan(150)
  },
}

// Values from docs/notion-spec/components/tooltip.md. Controlled `open` keeps both
// tooltips up regardless of where the test pointer rests.
export const SpecStyling: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex h-60 items-center justify-between px-16">
      <Tooltip open>
        <TooltipTrigger
          render={<Button size="icon" aria-label="Link kopieren" />}
        >
          <Link />
        </TooltipTrigger>
        <TooltipContent data-testid="default">
          Link kopieren
          <TooltipShortcut data-testid="default-shortcut">⌘⌥L</TooltipShortcut>
        </TooltipContent>
      </Tooltip>
      <Tooltip open>
        <TooltipTrigger
          delay={140}
          render={<Button variant="assistant" aria-label="KI" />}
        >
          <Sparkles />
        </TooltipTrigger>
        <TooltipContent variant="card" data-testid="card">
          Über diese Seite chatten
          <TooltipShortcut data-testid="card-shortcut">⌘J</TooltipShortcut>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const dark = canvasElement.closest(".dark") !== null
    const canvas = within(canvasElement)
    const style = (el: Element) => getComputedStyle(el)
    const rect = (el: Element) => el.getBoundingClientRect()
    const chip = await body.findByTestId("default")
    const card = await body.findByTestId("card")
    await waitFor(() => expect(style(card).opacity).toBe("1"))

    // Dark chip: identical in both themes (bacAccPri, texInvPri, texInvSec)
    await expect(style(chip).backgroundColor).toBe("rgb(44, 44, 43)")
    await expect(style(chip).color).toBe("rgb(240, 239, 237)")
    await expect(style(chip).borderRadius).toBe("6px")
    await expect(style(chip).padding).toBe("5px 8px")
    await expect(style(chip).fontSize).toBe("12px")
    await expect(style(chip).maxWidth).toBe("300px")
    await expect(style(chip).boxShadow).toContain("0px 4px 12px -2px")
    const chipShortcut = body.getByTestId("default-shortcut")
    await expect(style(chipShortcut).display).toBe("block")
    await expect(style(chipShortcut).color).toBe("rgb(173, 169, 163)")

    // Below the trigger, 6px gap, centred
    const link = rect(canvas.getByRole("button", { name: "Link kopieren" }))
    await expect(Math.round(rect(chip).top - link.bottom)).toBe(6)
    await expect(
      Math.round(
        rect(chip).left + rect(chip).width / 2 - (link.left + link.width / 2),
      ),
    ).toBeCloseTo(0, 0)

    // Card: bacEle surface with shaOutMd, texPri text
    await expect(style(card).backgroundColor).toBe(
      dark ? "rgb(32, 32, 32)" : "rgb(255, 255, 255)",
    )
    await expect(style(card).color).toBe(
      dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)",
    )
    await expect(style(card).borderRadius).toBe("10px")
    await expect(style(card).padding).toBe("6px 10px")
    await expect(style(card).fontSize).toBe("14px")
    await expect(style(card).boxShadow).toContain(
      dark ? "rgb(56, 56, 54) 0px 0px 0px 1px" : "0px 8px 12px 0px",
    )

    // Shortcut chip: texTer on bacSec, 12px medium, 4px after the label
    const cardShortcut = body.getByTestId("card-shortcut")
    await expect(style(cardShortcut).backgroundColor).toBe(
      dark ? "rgb(32, 32, 32)" : "rgb(249, 248, 247)",
    )
    await expect(style(cardShortcut).color).toBe(
      dark ? "rgb(125, 122, 117)" : "rgb(161, 158, 153)",
    )
    await expect(style(cardShortcut).fontSize).toBe("12px")
    await expect(style(cardShortcut).fontWeight).toBe("500")
    await expect(style(cardShortcut).borderRadius).toBe("4px")
    await expect(style(cardShortcut).padding).toBe("0px 4px")
    await expect(style(cardShortcut).marginLeft).toBe("4px")

    // Above the trigger, 8px gap, aligned to its end
    const fab = rect(canvas.getByRole("button", { name: "KI" }))
    await expect(Math.round(fab.top - rect(card).bottom)).toBe(8)
    await expect(Math.round(rect(card).right - fab.right)).toBeCloseTo(0, 0)
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
