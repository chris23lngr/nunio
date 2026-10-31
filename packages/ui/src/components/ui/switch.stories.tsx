import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Switch } from "./switch.js"

const meta = {
  title: "Components/Switch",
  component: Switch,
} satisfies Meta<typeof Switch>
export default meta

type Story = StoryObj<typeof meta>

const rect = (el: Element) => el.getBoundingClientRect()

// Thumb offset from the switch's left edge
function thumbOffset(root: HTMLElement) {
  const thumb = root.querySelector("[data-slot=switch-thumb]")
  if (!thumb) throw new Error("switch has no thumb")
  return Math.round(rect(thumb).left - rect(root).left)
}

export const Basic: Story = {
  args: { "aria-label": "Seite sperren" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const root = canvas.getByRole("switch", { name: "Seite sperren" })
    await expect(root).toHaveAttribute("aria-checked", "false")
    await expect(thumbOffset(root)).toBe(2)

    // A click turns it on and slides the thumb 12px
    await userEvent.click(root)
    await expect(root).toHaveAttribute("aria-checked", "true")
    await waitFor(() => expect(thumbOffset(root)).toBe(14))

    // Space toggles it back from the keyboard
    await userEvent.keyboard(" ")
    await expect(root).toHaveAttribute("aria-checked", "false")
    await waitFor(() => expect(thumbOffset(root)).toBe(2))
  },
}

// Values from docs/notion-spec/components/switch.md
export const SpecStyling: Story = {
  render: () => (
    <div className="flex gap-4">
      <Switch aria-label="Aus" data-testid="off" />
      <Switch aria-label="An" defaultChecked data-testid="on" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const dark = document.documentElement.classList.contains("dark")
    const canvas = within(canvasElement)
    const style = (el: Element) => getComputedStyle(el)
    const off = canvas.getByTestId("off")
    const on = canvas.getByTestId("on")
    const track = (root: HTMLElement) => {
      const el = root.querySelector("[data-slot=switch-track]")
      if (!el) throw new Error("switch has no track")
      return el
    }

    // 30×18 pill, 14px white thumb inset 2px
    await expect(rect(off).width).toBe(30)
    await expect(rect(off).height).toBe(18)
    const thumb = off.querySelector("[data-slot=switch-thumb]")
    if (!thumb) throw new Error("switch has no thumb")
    await expect(rect(thumb).width).toBe(14)
    await expect(style(thumb).backgroundColor).toBe("rgb(255, 255, 255)")
    await expect(style(thumb).boxShadow).toBe("none")

    // Off: swiButTeaBg, 30% gray; on: bluBacAccPri (#2783de in both themes)
    await waitFor(() =>
      expect(style(track(off)).backgroundColor).toBe(
        dark ? "rgba(120, 129, 135, 0.3)" : "rgba(135, 131, 120, 0.3)",
      ),
    )
    await waitFor(() =>
      expect(style(track(on)).backgroundColor).toBe("rgb(39, 131, 222)"),
    )
    await expect(thumbOffset(on)).toBe(14)

    // Track color eases (CSS `ease`), the thumb slides with ease-out, 200ms
    await expect(style(track(off)).transitionDuration).toContain("0.2s")
    await expect(style(track(off)).transitionTimingFunction).toBe("ease")
    await expect(style(thumb).transitionTimingFunction).toBe("ease-out")

    // Keyboard focus rings the switch like a button (butBluFocRin)
    await userEvent.tab()
    await expect(off).toHaveFocus()
    await expect(style(off).boxShadow).toContain(
      "rgb(35, 131, 226) 0px 0px 0px 4px",
    )
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
