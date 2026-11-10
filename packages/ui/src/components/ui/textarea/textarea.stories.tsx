import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fn, userEvent, within } from "storybook/test"
import { Textarea } from "./textarea.js"

const meta = {
  title: "Components/new/Textarea",
  component: Textarea,
  args: {
    "aria-label": "Lernziel",
    placeholder: "Beschreibe dein Lernziel …",
    onChange: fn(),
  },
  argTypes: {
    disabled: { control: "boolean" },
    readOnly: { control: "boolean" },
    "aria-invalid": { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div className="w-96 max-w-full p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>
export default meta

type Story = StoryObj<typeof meta>

function tokenColor(canvas: HTMLElement, token: string) {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  canvas.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

export const Placeholder: Story = {
  play: async ({ canvasElement, args }) => {
    const textarea = within(canvasElement).getByRole("textbox", {
      name: "Lernziel",
    })
    const style = getComputedStyle(textarea)
    await expect(textarea.getBoundingClientRect().height).toBe(64)
    await expect(style.borderRadius).toBe("6px")
    await expect(style.paddingLeft).toBe("10px")
    await expect(style.paddingRight).toBe("10px")
    await expect(style.paddingTop).toBe("8px")
    await expect(style.paddingBottom).toBe("8px")
    await expect(style.fontSize).toBe("14px")
    await expect(style.lineHeight).toBe("20px")
    await expect(style.fontWeight).toBe("500")
    await expect(style.resize).toBe("vertical")
    await expect(style.backgroundColor).toBe(
      tokenColor(canvasElement, "--color-white"),
    )
    await expect(style.color).toBe(tokenColor(canvasElement, "--base-800"))
    await expect(getComputedStyle(textarea, "::placeholder").color).toBe(
      tokenColor(canvasElement, "--base-500"),
    )
    await userEvent.type(textarea, "Mikroökonomie{Enter}Drei Übungsfragen")
    await expect(textarea).toHaveValue("Mikroökonomie\nDrei Übungsfragen")
    await expect(args.onChange).toHaveBeenCalled()
  },
}

export const Focus: Story = {
  args: {
    defaultValue: "Ich möchte mich auf die nächste Prüfung vorbereiten.",
  },
  play: async ({ canvasElement }) => {
    const textarea = within(canvasElement).getByRole("textbox", {
      name: "Lernziel",
    })
    await userEvent.tab()
    textarea.focus()
    await expect(textarea).toHaveFocus()
    await expect(textarea.matches(":focus-visible")).toBe(true)
    const style = getComputedStyle(textarea)
    await expect(style.boxShadow).toContain(
      tokenColor(canvasElement, "--primary-400"),
    )
    await expect(style.boxShadow).toContain(
      tokenColor(canvasElement, "--color-white"),
    )
    await expect(style.getPropertyValue("--tw-ring-offset-width")).toBe("4px")
    await expect(style.boxShadow).toContain("0px 0px 0px 6px")
  },
}

export const Invalid: Story = {
  args: {
    defaultValue: "Ich möchte mich auf die nächste Prüfung vorbereiten.",
    "aria-invalid": true,
  },
  play: async ({ canvasElement }) => {
    const textarea = within(canvasElement).getByRole("textbox", {
      name: "Lernziel",
    })
    const invalidColor = tokenColor(canvasElement, "--destructive-500")
    await expect(getComputedStyle(textarea).boxShadow).toContain(invalidColor)
    await userEvent.tab()
    textarea.focus()
    await expect(textarea).toHaveFocus()
    await expect(getComputedStyle(textarea).boxShadow).toContain(invalidColor)
    await expect(getComputedStyle(textarea).boxShadow).not.toContain(
      tokenColor(canvasElement, "--primary-400"),
    )
    textarea.blur()
    await expect(getComputedStyle(textarea).boxShadow).toContain(invalidColor)
  },
}

export const Disabled: Story = {
  args: { defaultValue: "Die Eingabe ist deaktiviert.", disabled: true },
  play: async ({ canvasElement, args }) => {
    const textarea = within(canvasElement).getByRole("textbox", {
      name: "Lernziel",
    })
    await expect(textarea).toBeDisabled()
    await expect(getComputedStyle(textarea).opacity).toBe("0.5")
    textarea.focus()
    await expect(textarea).not.toHaveFocus()
    await expect(textarea).toHaveValue("Die Eingabe ist deaktiviert.")
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

export const GrowsWithContent: Story = {
  play: async ({ canvasElement }) => {
    const textarea = within(canvasElement).getByRole("textbox", {
      name: "Lernziel",
    })
    await userEvent.type(
      textarea,
      "Erste Zeile{Enter}Zweite Zeile{Enter}Dritte Zeile{Enter}Vierte Zeile",
    )
    await expect(textarea.getBoundingClientRect().height).toBe(96)
    await expect(textarea.scrollHeight).toBe(textarea.clientHeight)
    await userEvent.clear(textarea)
    await expect(textarea.getBoundingClientRect().height).toBe(64)
  },
}

export const Filled: Story = {
  args: {
    defaultValue:
      "Ich möchte mich auf die nächste Prüfung vorbereiten.\nHilf mir, die wichtigsten Themen zu strukturieren.",
  },
  play: async ({ canvasElement }) => {
    const textarea = within(canvasElement).getByRole("textbox", {
      name: "Lernziel",
    })
    await expect(textarea).toHaveValue(
      "Ich möchte mich auf die nächste Prüfung vorbereiten.\nHilf mir, die wichtigsten Themen zu strukturieren.",
    )
    const shadow = getComputedStyle(textarea).boxShadow
    await expect(shadow).toContain("rgba(0, 0, 0, 0.1) 0px 1px 3px 0px")
    await expect(shadow).toContain("rgba(0, 0, 0, 0.1) 0px 1px 2px -1px")
  },
}

export const ReadOnly: Story = {
  args: { defaultValue: "Dieses Lernziel bleibt erhalten.", readOnly: true },
  play: async ({ canvasElement, args }) => {
    const textarea = within(canvasElement).getByRole("textbox", {
      name: "Lernziel",
    })
    await userEvent.type(textarea, " ändern")
    await expect(textarea).toHaveValue("Dieses Lernziel bleibt erhalten.")
    await expect(textarea).toHaveFocus()
    await expect(getComputedStyle(textarea).opacity).toBe("1")
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

export const Controlled: Story = {
  render: function Controlled(args) {
    const [value, setValue] = useState("Mikroökonomie")
    return (
      <Textarea
        {...args}
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value)
          args.onChange?.(event)
        }}
      />
    )
  },
  play: async ({ canvasElement, args }) => {
    const textarea = within(canvasElement).getByRole("textbox", {
      name: "Lernziel",
    })
    await userEvent.type(textarea, "{End}{Enter}Übungsfragen")
    await expect(textarea).toHaveValue("Mikroökonomie\nÜbungsfragen")
    await expect(args.onChange).toHaveBeenCalled()
  },
}

export const NarrowContainer: Story = {
  render: (args) => (
    <div className="w-40">
      <Textarea
        {...args}
        defaultValue="EinlangesLernzielohneLeerzeichenDasDenVerfügbarenPlatzÜberschreitet"
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const textarea = within(canvasElement).getByRole("textbox", {
      name: "Lernziel",
    })
    await expect(textarea.getBoundingClientRect().width).toBe(160)
    await expect(textarea.scrollWidth).toBe(textarea.clientWidth)
    await expect(textarea.scrollHeight).toBe(textarea.clientHeight)
  },
}
