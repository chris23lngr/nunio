import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Command as CommandKey,
  CornerDownLeft,
  FileText,
  Settings2,
} from "lucide-react"
import * as React from "react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "./button.js"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command.js"

const meta = {
  title: "Components/Command",
  component: Command,
} satisfies Meta<typeof Command>
export default meta

type Story = StoryObj<typeof meta>

const body = within(document.body)

const emoji = "flex size-[18px] items-center justify-center text-sm"

// Shaped like Notion's ⌘K search: recent pages, templates, a hint footer
function SearchMenu() {
  return (
    <Command>
      <CommandInput placeholder="Christoph durchsuchen oder Frage stellen…" />
      <CommandList>
        <CommandEmpty>
          Keine Ergebnisse
          <span className="text-tertiary font-normal">
            Einige Ergebnisse befinden sich möglicherweise auf deinen gelöschten
            Seiten.
          </span>
        </CommandEmpty>
        <CommandGroup heading="Gestern">
          <CommandItem>
            <FileText />🚀 Pilotkunden Akquise
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Beginne mit einer Vorlage">
          <CommandItem>
            <span className={emoji}>📚</span>
            Planer für Studierende
          </CommandItem>
          <CommandItem>
            <span className={emoji}>✏️</span>
            Klassennotizen
          </CommandItem>
          <CommandItem>
            <span className={emoji}>🗓️</span>
            Stundenplan
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <CommandFooter>
        <CommandKey />
        <CornerDownLeft className="-ml-1" />
        In neuem Tab öffnen
        <Button
          size="icon-sm"
          aria-label="Sucheinstellungen"
          className="ml-auto"
        >
          <Settings2 />
        </Button>
      </CommandFooter>
    </Command>
  )
}

function SearchDialog({
  defaultOpen = false,
  ...props
}: React.ComponentProps<typeof CommandDialog>) {
  const [open, setOpen] = React.useState(defaultOpen)

  React.useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <>
      <Button onClick={() => setOpen(true)}>Suchen</Button>
      <CommandDialog
        title="Suche"
        description="Seiten durchsuchen oder Frage stellen"
        {...props}
        open={open}
        onOpenChange={setOpen}
      >
        <SearchMenu />
      </CommandDialog>
    </>
  )
}

export const Basic: Story = {
  render: () => <SearchDialog />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("button", { name: "Suchen" })

    // Opens named by its title with the input focused and the first row selected
    await userEvent.click(trigger)
    await body.findByRole("dialog", { name: "Suche" })
    const input = body.getByRole("combobox")
    await waitFor(() => expect(input).toHaveFocus())
    const options = () => body.getAllByRole("option")
    const option = (index: number) => {
      const element = options()[index]
      if (!element) throw new Error(`option ${index} not found`)
      return element
    }
    await expect(option(0)).toHaveAttribute("aria-selected", "true")

    // Hover tints a row but leaves the selection, and no row is ringed yet
    await userEvent.hover(option(2))
    await expect(option(0)).toHaveAttribute("aria-selected", "true")
    await expect(getComputedStyle(option(0)).boxShadow).toBe("none")

    // The keyboard moves the selection and rings it
    await userEvent.keyboard("{ArrowDown}")
    await expect(option(1)).toHaveAttribute("aria-selected", "true")
    await expect(getComputedStyle(option(1)).boxShadow).not.toBe("none")

    // Typing filters; no match shows Empty
    await userEvent.type(input, "Klassen")
    await waitFor(() => expect(options()).toHaveLength(1))
    await userEvent.type(input, "qxz")
    await body.findByText("Keine Ergebnisse")

    // Escape closes and returns focus to the trigger; ⌘K reopens
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await expect(trigger).toHaveFocus()
    await userEvent.keyboard("{Meta>}k{/Meta}")
    await body.findByRole("dialog", { name: "Suche" })
    await userEvent.keyboard("{Escape}")
  },
}

export const Inline: Story = {
  render: () => (
    <div className="bg-elevated h-80 w-[480px] overflow-hidden rounded-xl shadow-lg">
      <SearchMenu />
    </div>
  ),
}

// Values from docs/notion-spec/components/command.md
export const SpecStyling: Story = {
  render: () => <SearchDialog defaultOpen />,
  play: async () => {
    const dark = document.documentElement.classList.contains("dark")
    const style = (el: Element) => getComputedStyle(el)
    const rect = (el: Element) => el.getBoundingClientRect()
    const popup = await body.findByRole("dialog")
    const box = rect(popup)

    // Frosted popWaxPapBac with a 40px blur, shaOutScr, 20px radius
    await expect(style(popup).backgroundColor).toBe(
      dark ? "rgba(32, 32, 32, 0.9)" : "rgba(255, 255, 255, 0.9)",
    )
    await expect(style(popup).backdropFilter).toBe("blur(40px)")
    await expect(style(popup).borderRadius).toBe("20px")
    await expect(style(popup).boxShadow).toContain(
      dark ? "rgb(56, 56, 54) 0px 0px 0px 1px" : "0px 24px 48px 0px",
    )

    // Centred, top at 9vh, height 91vh − 16px
    await expect(box.top).toBeCloseTo(innerHeight * 0.09, 0)
    await expect(box.height).toBeCloseTo(innerHeight * 0.91 - 16, 0)
    await expect(box.left - (innerWidth - box.right)).toBeCloseTo(0, 0)

    // Transparent overlay
    const backdrop = document.querySelector(
      "[data-slot=command-dialog-backdrop]",
    )
    if (!backdrop) throw new Error("backdrop not found")
    await expect(style(backdrop).backgroundColor).toBe("rgba(0, 0, 0, 0)")

    // 48px input row: icon 16px in, text 50px in, 16/24
    const input = body.getByRole("combobox")
    const icon = popup.querySelector("[data-slot=command-input-wrapper] svg")
    if (!icon) throw new Error("search icon not found")
    await expect(rect(icon).left - box.left).toBe(16)
    await expect(rect(icon).width).toBe(22)
    await expect(rect(input).left - box.left).toBe(50)
    await expect(style(input).fontSize).toBe("16px")
    await expect(style(input).lineHeight).toBe("24px")

    // 12/14.4 medium heading 10px into its group, first row 8px below it
    const group = popup.querySelector("[cmdk-group]")
    const heading = popup.querySelector("[cmdk-group-heading]")
    if (!group || !heading) throw new Error("group not found")
    await expect(rect(heading).top - rect(group).top).toBe(10)
    await expect(style(heading).fontSize).toBe("12px")
    await expect(style(heading).fontWeight).toBe("500")

    // 36px rows, 12px radius, 1px apart, label 28px past the padding;
    // the selected row takes bacIntTra
    const [first, , second] = body.getAllByRole("option")
    if (!first || !second) throw new Error("options not found")
    await expect(rect(first).height).toBe(36)
    await expect(style(first).borderRadius).toBe("12px")
    await expect(rect(first).top - rect(heading).bottom).toBeCloseTo(8, 0)
    await expect(style(first).backgroundColor).not.toBe("rgba(0, 0, 0, 0)")
    const rows = body.getAllByRole("option")
    await expect(
      rect(rows[2] as Element).top - rect(rows[1] as Element).bottom,
    ).toBe(1)
    const rowIcon = first.querySelector("svg")
    if (!rowIcon) throw new Error("row icon not found")
    await expect(rect(rowIcon).width).toBe(18)

    // 41px footer with a 1px borSecTra rule
    const footer = popup.querySelector("[data-slot=command-footer]")
    if (!footer) throw new Error("footer not found")
    await expect(rect(footer).height).toBe(41)
    await expect(style(footer).borderTopWidth).toBe("1px")
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
