import type { Meta, StoryObj } from "@storybook/react-vite"
import { Sparkles } from "lucide-react"
import { useState } from "react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "../button/button.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../dropdown-menu/dropdown-menu.js"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js"

const meta = {
  title: "Components/new/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>
export default meta

type Story = StoryObj<typeof meta>

function ModelCard() {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        Modell-Info
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>
            <Sparkles />
            <span>
              <span className="text-base-500 font-normal">Anthropic /</span>{" "}
              Opus 5.5
            </span>
          </PopoverTitle>
          <PopoverDescription>
            Das leistungsstärkste Modell für komplexe Aufgaben.
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  )
}

export const Playground: Story = {
  render: () => <ModelCard />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Modell-Info",
    })
    const body = within(document.body)
    await userEvent.click(trigger)
    const dialog = await body.findByRole("dialog")
    await expect(dialog).toHaveAccessibleName("Anthropic / Opus 5.5")
    await expect(dialog).toHaveAccessibleDescription(
      "Das leistungsstärkste Modell für komplexe Aufgaben.",
    )
    await userEvent.click(trigger)
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await userEvent.click(trigger)
    await body.findByRole("dialog")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await expect(trigger).toHaveFocus()
  },
}

function tokenColor(token: string) {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  document.body.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

function outlineColor(token: string) {
  const probe = document.createElement("span")
  probe.className = token
  document.body.append(probe)
  const color = getComputedStyle(probe).outlineColor
  probe.remove()
  return color
}

export const Design: Story = {
  render: () => <ModelCard />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Modell-Info" }),
    )
    const content = await within(document.body).findByRole("dialog")
    await waitFor(() => expect(getComputedStyle(content).opacity).toBe("1"))
    const box = getComputedStyle(content)
    await expect(content.getBoundingClientRect().width).toBe(288)
    await expect(box.backgroundColor).toBe("rgb(255, 255, 255)")
    await expect(box.borderRadius).toBe("8px")
    await expect(box.padding).toBe("14px")
    await expect([box.outlineStyle, box.outlineWidth]).toEqual(["solid", "1px"])
    await expect(box.outlineColor).toBe(outlineColor("outline-base-700/15"))
    // Tailwind prefixes transparent ring/inset layers; the visible layers come last.
    await expect(
      box.boxShadow.endsWith(
        "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px",
      ),
    ).toBe(true)

    const header = content.querySelector("[data-slot=popover-header]")
    const title = content.querySelector("[data-slot=popover-title]")
    const description = content.querySelector("[data-slot=popover-description]")
    const icon = title?.querySelector("svg")
    const prefix = title?.querySelector(".text-base-500")
    if (!header || !title || !description || !icon || !prefix)
      throw new Error("Missing card parts")
    await expect(getComputedStyle(header).rowGap).toBe("6px")
    const titleStyle = getComputedStyle(title)
    await expect([
      titleStyle.fontSize,
      titleStyle.lineHeight,
      titleStyle.fontWeight,
      titleStyle.columnGap,
    ]).toEqual(["14px", "20px", "500", "8px"])
    await expect(titleStyle.color).toBe(tokenColor("--base-700"))
    await expect(icon.getBoundingClientRect().width).toBe(16)
    await expect(getComputedStyle(prefix).color).toBe(tokenColor("--base-500"))
    await expect(getComputedStyle(prefix).fontWeight).toBe("400")
    const descStyle = getComputedStyle(description)
    await expect([descStyle.fontSize, descStyle.lineHeight]).toEqual([
      "12px",
      "16px",
    ])
    await expect(descStyle.color).toBe(tokenColor("--base-500"))
  },
}

const models = [
  {
    name: "Opus 5.5",
    description: "Das leistungsstärkste Modell für komplexe Aufgaben.",
  },
  {
    name: "Sonnet 5",
    description: "Ausgewogen zwischen Qualität und Geschwindigkeit.",
  },
  {
    name: "Haiku 4.5",
    description: "Das schnellste Modell für einfache Aufgaben.",
  },
]

type Model = (typeof models)[number]

// The card is a controlled Popover anchored to the highlighted menu row.
// Base UI moves DOM focus to a Menu item whenever it is highlighted, by pointer
// hover or by arrow keys, so `onFocus` tracks both. Focus stays in the menu:
// the card neither takes focus on open nor returns it on close.
function ModelMenu() {
  const [card, setCard] = useState<{ model: Model; row: HTMLElement }>()
  const [open, setOpen] = useState(false)
  return (
    <>
      <DropdownMenu onOpenChange={(menuOpen) => !menuOpen && setOpen(false)}>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          Modell
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            {models.map((model) => (
              <DropdownMenuItem
                key={model.name}
                onFocus={(event) => {
                  setCard({ model, row: event.currentTarget })
                  setOpen(true)
                }}
              >
                <Sparkles />
                {model.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverContent
          anchor={card?.row}
          side="right"
          align="start"
          sideOffset={8}
          // Centers the title on the row's text: the title's center sits 24px
          // into the card (14px padding + 20px/2), the row's 14px (4px + 20px/2).
          alignOffset={-10}
          initialFocus={false}
          finalFocus={false}
        >
          <PopoverHeader>
            <PopoverTitle>
              <Sparkles />
              <span>
                <span className="text-base-500 font-normal">Anthropic /</span>{" "}
                {card?.model.name}
              </span>
            </PopoverTitle>
            <PopoverDescription>{card?.model.description}</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </>
  )
}

function titleCenter(card: HTMLElement) {
  const title = card.querySelector("[data-slot=popover-title]")
  if (!title) throw new Error("Popover title not found")
  const { top, height } = title.getBoundingClientRect()
  return top + height / 2
}

export const FromMenuItem: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Hovering or arrow-keying to a model row shows its info card to the right of that row.",
      },
    },
  },
  render: () => <ModelMenu />,
  play: async ({ canvasElement }) => {
    const body = within(document.body)
    const trigger = within(canvasElement).getByRole("button", {
      name: "Modell",
    })
    await userEvent.click(trigger)
    const menu = await body.findByRole("menu")
    const opus = within(menu).getByRole("menuitem", { name: "Opus 5.5" })
    const sonnet = within(menu).getByRole("menuitem", { name: "Sonnet 5" })

    await userEvent.hover(opus)
    const card = await body.findByRole("dialog", {
      name: "Anthropic / Opus 5.5",
    })
    await expect(card).toHaveAccessibleDescription(models[0]?.description)
    await waitFor(() => {
      const row = opus.getBoundingClientRect()
      expect(card.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        row.right,
      )
      expect(titleCenter(card)).toBeCloseTo(row.top + row.height / 2, 0)
    })
    await expect(opus).toHaveFocus()

    await userEvent.keyboard("{ArrowDown}")
    await waitFor(() => expect(sonnet).toHaveFocus())
    await waitFor(() =>
      expect(body.getByRole("dialog")).toHaveAccessibleName(
        "Anthropic / Sonnet 5",
      ),
    )
    await expect(body.getAllByRole("dialog")).toHaveLength(1)
    await waitFor(() => {
      const row = sonnet.getBoundingClientRect()
      expect(titleCenter(body.getByRole("dialog"))).toBeCloseTo(
        row.top + row.height / 2,
        0,
      )
    })

    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull())
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await expect(trigger).toHaveFocus()
  },
}
