import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import { cn } from "../lib/utils.js"

const meta = {
  title: "Foundations/Colors",
  parameters: { layout: "padded" },
} satisfies Meta
export default meta

const COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
  "teal",
] as const

const LEVELS = ["primary", "secondary", "tertiary", "disabled"] as const

// Static class lists so Tailwind can see every utility
const TEXT: Record<string, string> = {
  primary: "text-primary",
  secondary: "text-secondary",
  tertiary: "text-tertiary",
  disabled: "text-disabled",
}

const TAG: Record<(typeof COLORS)[number], string> = {
  gray: "bg-gray-secondary text-gray-primary",
  brown: "bg-brown-secondary text-brown-primary",
  orange: "bg-orange-secondary text-orange-primary",
  yellow: "bg-yellow-secondary text-yellow-primary",
  green: "bg-green-secondary text-green-primary",
  blue: "bg-blue-secondary text-blue-primary",
  purple: "bg-purple-secondary text-purple-primary",
  pink: "bg-pink-secondary text-pink-primary",
  red: "bg-red-secondary text-red-primary",
  teal: "bg-teal-secondary text-teal-primary",
}

const COLORED_TEXT: Record<(typeof COLORS)[number], string> = {
  gray: "text-gray-secondary",
  brown: "text-brown-secondary",
  orange: "text-orange-secondary",
  yellow: "text-yellow-secondary",
  green: "text-green-secondary",
  blue: "text-blue-secondary",
  purple: "text-purple-secondary",
  pink: "text-pink-secondary",
  red: "text-red-secondary",
  teal: "text-teal-secondary",
}

const SURFACES = [
  ["bg-primary", "primary"],
  ["bg-secondary", "secondary"],
  ["bg-tertiary", "tertiary"],
  ["bg-popover shadow-md", "popover + shadow-md"],
  ["bg-hover", "hover"],
  ["bg-pressed", "pressed"],
] as const

export const Overview: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8 text-sm">
      <section className="flex flex-col gap-1">
        {LEVELS.map((level) => (
          <p key={level} className={TEXT[level]} data-testid={`text-${level}`}>
            Text {level}
          </p>
        ))}
      </section>

      <section className="flex flex-wrap gap-2">
        {COLORS.map((color) => (
          <span key={color} className={cn("rounded px-1.5 py-0.5", TAG[color])}>
            {color}
          </span>
        ))}
      </section>

      <section className="flex flex-wrap gap-3">
        {COLORS.map((color) => (
          <span key={color} className={COLORED_TEXT[color]}>
            {color}
          </span>
        ))}
      </section>

      <section className="flex flex-wrap gap-3">
        {SURFACES.map(([className, label]) => (
          <div
            key={label}
            className={cn(
              "border-primary text-secondary flex h-16 w-32 items-end rounded-md border p-2 text-xs",
              className,
            )}
          >
            {label}
          </div>
        ))}
      </section>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const color = (id: string) => getComputedStyle(canvas.getByTestId(id)).color
    const dark = canvasElement.closest(".dark") !== null
    // texPri / texSec from Notion: light #2c2c2b / #7d7a75, dark #f0efed / #ada9a3
    await expect(color("text-primary")).toBe(
      dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)",
    )
    await expect(color("text-secondary")).toBe(
      dark ? "rgb(173, 169, 163)" : "rgb(125, 122, 117)",
    )
  },
}

export const ClassMerging: StoryObj = {
  render: () => (
    <p data-testid="merged" className={cn("text-secondary text-sm", "text-xs")}>
      Merged
    </p>
  ),
  play: async ({ canvasElement }) => {
    // A semantic text color must not be dropped as a font-size conflict
    const merged = within(canvasElement).getByTestId("merged")
    await expect(merged.className).toBe("text-secondary text-xs")
  },
}

export const OverviewDark: StoryObj = {
  ...Overview,
  globals: { theme: "dark" },
}
