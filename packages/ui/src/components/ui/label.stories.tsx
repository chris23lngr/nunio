import { Field } from "@base-ui/react/field"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import { Label } from "./label.js"
import { Switch } from "./switch.js"

const meta = {
  title: "Components/Label",
  component: Label,
} satisfies Meta<typeof Label>
export default meta

type Story = StoryObj<typeof meta>

const style = (el: Element) => getComputedStyle(el)

// Notion's profile field: compact label above a text input
function NameField() {
  return (
    <Field.Root className="flex w-[250px] flex-col">
      <Label variant="compact" className="mb-1" data-testid="compact">
        Bevorzugter Name
      </Label>
      <Field.Control
        defaultValue="Christoph"
        className="bg-secondary-translucent h-7 rounded-md px-2 text-sm"
      />
    </Field.Root>
  )
}

// A settings row: default label beside a switch. The switch is not a native
// form control, so the label renders a div and names it via aria-labelledby.
function SwitchRow() {
  return (
    <Field.Root className="flex w-[480px] items-center justify-between gap-4">
      <Label nativeLabel={false} render={<div />} data-testid="default">
        Verwende die Eingabetaste, um eine neue Zeile hinzuzufügen
      </Label>
      <Switch />
    </Field.Root>
  )
}

export const Basic: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <NameField />
      <SwitchRow />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Both labels name their control
    const input = canvas.getByRole("textbox", { name: "Bevorzugter Name" })
    await expect(
      canvas.getByRole("switch", { name: /Eingabetaste/ }),
    ).toBeInTheDocument()

    // Labels are not focus stops, and focusing the control leaves them as is
    const label = canvas.getByTestId("compact")
    const before = style(label).color
    await userEvent.tab()
    await expect(input).toHaveFocus()
    await expect(style(label).color).toBe(before)
    await expect(style(label).boxShadow).toBe("none")
  },
}

// Values from docs/notion-spec/components/label.md
export const SpecStyling: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <NameField />
      <SwitchRow />
      <Field.Root className="w-[200px]">
        <Label data-testid="wrapped">
          Verwende die Eingabetaste, um eine neue Zeile hinzuzufügen
        </Label>
      </Field.Root>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const dark = document.documentElement.classList.contains("dark")
    const canvas = within(canvasElement)
    const label = canvas.getByTestId("default")
    const compact = canvas.getByTestId("compact")

    // Default: 14/20 medium in texPri
    await expect(style(label).fontSize).toBe("14px")
    await expect(style(label).lineHeight).toBe("20px")
    await expect(style(label).fontWeight).toBe("500")
    await expect(style(label).color).toBe(
      dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)",
    )

    // Compact: 12/16 regular in texSec, a block filling its field
    await expect(style(compact).fontSize).toBe("12px")
    await expect(style(compact).lineHeight).toBe("16px")
    await expect(style(compact).fontWeight).toBe("400")
    await expect(style(compact).color).toBe(
      dark ? "rgb(173, 169, 163)" : "rgb(125, 122, 117)",
    )
    await expect(style(compact).display).toBe("block")
    await expect(compact.getBoundingClientRect().width).toBe(250)

    // Plain text: no box, no transition, wraps in 20px lines
    for (const el of [label, compact]) {
      await expect(style(el).padding).toBe("0px")
      await expect(style(el).backgroundColor).toBe("rgba(0, 0, 0, 0)")
      await expect(style(el).transitionDuration).toBe("0s")
    }
    // System fonts wrap differently across platforms; every line stays 20px.
    await expect(label.getBoundingClientRect().width).toBeLessThan(480)
    const wrapped = canvas.getByTestId("wrapped")
    const text = document.createRange()
    text.selectNodeContents(wrapped)
    const lines = text.getClientRects().length
    await expect(lines).toBeGreaterThan(1)
    await expect(wrapped.getBoundingClientRect().height).toBe(lines * 20)
    await expect(wrapped.getBoundingClientRect().width).toBeLessThanOrEqual(200)
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
