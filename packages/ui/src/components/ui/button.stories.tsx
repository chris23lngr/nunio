import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  ChevronDown,
  Copy,
  Ellipsis,
  Link,
  Lock,
  Plus,
  Sparkles,
  Table,
} from "lucide-react"
import { expect, within } from "storybook/test"
import { Button } from "./button.js"

const meta = {
  title: "Components/Button",
  component: Button,
  args: { children: "Teilen" },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "ghost",
        "primary",
        "secondary",
        "outline",
        "destructive",
        "pill",
        "assistant",
      ],
    },
    size: {
      control: "select",
      options: ["sm", "default", "lg", "compact", "icon", "icon-sm", "icon-xs"],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

// Every variant from docs/notion-spec/components/button.md, labelled as in Notion
export const Gallery: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex flex-col items-start gap-6">
      <section className="flex items-center gap-1">
        <Button data-testid="ghost">
          <Lock />
          Teilen
        </Button>
        <Button size="sm" data-testid="ghost-sm">
          <Lock />
          Privat
          <ChevronDown className="text-icon-tertiary size-[11px]" />
        </Button>
        <Button size="icon" aria-label="Link kopieren" data-testid="icon-link">
          <Link />
        </Button>
        <Button size="icon" aria-label="Aktionen" data-testid="icon">
          <Ellipsis className="size-[22px]" />
        </Button>
        <Button size="icon-sm" aria-label="Kopieren">
          <Copy />
        </Button>
        <Button
          size="icon-xs"
          aria-label="Unterseite hinzufügen"
          data-testid="icon-xs"
        >
          <Plus />
        </Button>
      </section>

      <section className="flex items-center gap-2">
        <Button variant="primary" size="lg" data-testid="primary">
          Einladen
        </Button>
        <Button variant="primary">Passkey hinzufügen</Button>
        <Button variant="secondary" data-testid="secondary">
          Loslegen
        </Button>
        <Button variant="destructive">Mein Konto löschen</Button>
      </section>

      <section className="flex items-center gap-2">
        <Button variant="outline" size="lg">
          <Link />
          Link kopieren
        </Button>
        <Button variant="outline">Passwort hinzufügen</Button>
        <Button variant="outline" size="compact" data-testid="compact">
          Abmelden
        </Button>
        <Button variant="outline" disabled data-testid="disabled">
          Verifizierungsmethode hinzufügen
        </Button>
      </section>

      <section className="flex items-center gap-2">
        <Button variant="pill" data-testid="pill">
          <Table />
          Datenbank
        </Button>
        <Button variant="assistant" aria-label="KI" data-testid="assistant">
          <Sparkles />
        </Button>
      </section>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = (id: string) => {
      const el = canvas.getByTestId(id)
      const r = el.getBoundingClientRect()
      return { el, style: getComputedStyle(el), w: r.width, h: r.height }
    }

    // Heights from the spec's variant table
    await expect(box("ghost").h).toBe(28)
    await expect(box("ghost-sm").h).toBe(24)
    await expect(box("primary").h).toBe(32)
    await expect(box("icon").w).toBe(28)
    await expect(box("icon-xs").w).toBe(20)

    // Variants that own their geometry win over the size classes
    const pill = box("pill")
    await expect(pill.h).toBe(32)
    await expect(pill.style.paddingLeft).toBe("10px")
    await expect(pill.style.paddingRight).toBe("14px")
    const assistant = box("assistant")
    await expect([assistant.w, assistant.h]).toEqual([40, 40])
    await expect(assistant.style.paddingLeft).toBe("0px")
    await expect(box("secondary").style.paddingLeft).toBe("12px")

    // A color class on the icon wins over the variant's default icon color:
    // the breadcrumb chevron is icoTer (light #ada9a3, dark #7d7a75)
    const chevron = box("ghost-sm").el.querySelectorAll("svg")[1]
    if (!chevron) throw new Error("ghost-sm has no chevron")
    await expect(getComputedStyle(chevron).color).toBe(
      canvasElement.closest(".dark")
        ? "rgb(125, 122, 117)"
        : "rgb(173, 169, 163)",
    )

    // Notion's 28px icon buttons draw ~15px filled glyphs; a 16px Lucide icon
    // matches that visually where a 20px one renders ~18px
    const linkIcon = box("icon-link").el.querySelector("svg")
    if (!linkIcon) throw new Error("icon button has no icon")
    await expect(linkIcon.getBoundingClientRect().width).toBe(16)

    // Notion keeps the platform's default font smoothing (subpixel on macOS)
    await expect(
      box("ghost").style.getPropertyValue("-webkit-font-smoothing"),
    ).toBe("auto")

    // Type and color
    await expect(box("ghost").style.fontWeight).toBe("400")
    await expect(box("primary").style.fontWeight).toBe("500")
    await expect(box("compact").style.fontSize).toBe("12px")
    await expect(box("disabled").style.opacity).toBe("0.4")

    const dark = canvasElement.closest(".dark") !== null
    // bluBacAccPri is #2783de in both themes
    await expect(box("primary").style.backgroundColor).toBe("rgb(39, 131, 222)")
    // texPri: light #2c2c2b, dark #f0efed
    await expect(box("ghost").style.color).toBe(
      dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)",
    )
  },
}

export const GalleryDark: Story = {
  ...Gallery,
  globals: { theme: "dark" },
}

// The pressed backgrounds are generated tokens; check they resolve to Notion's values
export const DerivedStates: Story = {
  render: () => (
    <div className="flex gap-2">
      <div data-testid="hover" className="bg-interactive-translucent size-8" />
      <div
        data-testid="pressed"
        className="bg-interactive-translucent-200 size-8"
      />
      <div
        data-testid="primary-hover"
        className="bg-blue-accent-hover size-8"
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alpha = (id: string) =>
      Number(
        getComputedStyle(canvas.getByTestId(id))
          .backgroundColor.match(/[\d.]+/g)
          ?.at(-1),
      )
    // bacIntTra has alpha 0x0d (light) / 0x0e (dark); pressed doubles it
    await expect(alpha("pressed") / alpha("hover")).toBeCloseTo(2, 1)
    // Notion's measured primary hover, #1f76cc
    const rgb = getComputedStyle(canvas.getByTestId("primary-hover"))
      .backgroundColor.match(/[\d.]+/g)
      ?.slice(0, 3)
      .map((c) => Math.round(Number(c) <= 1 ? Number(c) * 255 : Number(c)))
    await expect(rgb).toEqual([31, 118, 204])
  },
}
