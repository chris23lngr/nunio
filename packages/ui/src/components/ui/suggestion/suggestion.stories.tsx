import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { Suggestion, Suggestions } from "./suggestion.js"

const prompts = [
  "Was habe ich heute noch in BWL1 zu tun?",
  "Erstelle mir Flashcards für FOF1",
  "Fasse die letzte Vorlesung in Mathe zusammen",
  "Erkläre mir die Kostenrechnung",
]

const meta = {
  title: "Components/new/Suggestion",
  component: Suggestion,
  args: { suggestion: prompts[0] ?? "", onClick: fn() },
} satisfies Meta<typeof Suggestion>
export default meta
type Story = StoryObj<typeof meta>

export const Preview: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Was habe ich heute noch in BWL1 zu tun?",
      }),
    )
    await expect(args.onClick).toHaveBeenCalledOnce()
    await expect(args.onClick).toHaveBeenCalledWith(
      "Was habe ich heute noch in BWL1 zu tun?",
    )
  },
}

export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.tab()
    const chip = within(canvasElement).getByRole("button")
    await expect(chip).toHaveFocus()
    await expect(getComputedStyle(chip).boxShadow).toContain(
      tokenColor(canvasElement, "var(--primary-500)"),
    )
    await userEvent.keyboard("{Enter}")
    await userEvent.keyboard(" ")
    await expect(args.onClick).toHaveBeenCalledTimes(2)
    await expect(args.onClick).toHaveBeenLastCalledWith(
      "Was habe ich heute noch in BWL1 zu tun?",
    )
  },
}

export const Design: Story = {
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole("button")
    const style = getComputedStyle(chip)
    await expect(chip.getBoundingClientRect().height).toBe(24)
    await expect([style.paddingLeft, style.paddingRight]).toEqual([
      "8px",
      "8px",
    ])
    await expect(Number.parseFloat(style.borderRadius)).toBeGreaterThanOrEqual(
      12,
    )
    await expect(style.backgroundColor).toBe(tokenColor(canvasElement, "#fff"))
    await expect(style.outlineWidth).toBe("1px")
    await expect(style.outlineColor).toBe(
      tokenColor(
        canvasElement,
        "color-mix(in oklab, var(--base-700) 15%, transparent)",
      ),
    )
    await expect(style.boxShadow).toMatch(
      /rgba\(0, 0, 0, 0.05\) 0px 1px 2px 0px$/,
    )
    await expect(style.fontSize).toBe("14px")
    await expect(style.lineHeight).toBe("20px")
    await expect(style.fontWeight).toBe("500")
    await expect(style.whiteSpace).toBe("nowrap")
    await expect(style.color).toBe(tokenColor(canvasElement, "var(--base-600)"))
  },
}

function tokenColor(canvas: HTMLElement, color: string) {
  const probe = document.createElement("span")
  probe.style.color = color
  canvas.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved
}

export const Group: Story = {
  render: (args) => (
    <Suggestions className="w-[640px]" data-testid="group">
      {prompts.map((prompt) => (
        <Suggestion key={prompt} suggestion={prompt} onClick={args.onClick} />
      ))}
    </Suggestions>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByTestId("group").getBoundingClientRect()
    const chips = canvas
      .getAllByRole("button")
      .map((chip) => chip.getBoundingClientRect())
    const [a, b, c, d] = chips
    if (!a || !b || !c || !d) throw new Error("Expected four suggestions")
    // Two rows of two, 16px apart in both directions
    await expect([a.top, b.top]).toEqual([group.top, group.top])
    await expect(c.top).toBe(a.bottom + 16)
    await expect(d.top).toBe(c.top)
    await expect(b.left).toBe(a.right + 16)
    await expect(d.left).toBe(c.right + 16)
    // Each row is centered
    for (const [first, last] of [
      [a, b],
      [c, d],
    ] as const) {
      await expect(first.left - group.left).toBeCloseTo(
        group.right - last.right,
        0,
      )
    }
    await userEvent.click(canvas.getByRole("button", { name: prompts[3] }))
    await expect(args.onClick).toHaveBeenCalledOnce()
    await expect(args.onClick).toHaveBeenCalledWith(prompts[3])
  },
}
