import type { Meta, StoryObj } from "@storybook/react-vite"
import { Plus, Search, Send } from "lucide-react"
import { useState } from "react"
import { expect, userEvent, within } from "storybook/test"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group.js"

const meta = {
  title: "Components/new/InputGroup",
  component: InputGroup,
  decorators: [
    (Story) => (
      <div className="w-96 max-w-full p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InputGroup>
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

export const InlineStart: Story = {
  render: () => (
    <InputGroup aria-label="Kurssuche">
      <InputGroupAddon aria-label="Suchsymbol">
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput aria-label="Kurs" placeholder="Kurse durchsuchen …" />
    </InputGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole("group", { name: "Kurssuche" })
    const input = canvas.getByRole("textbox", { name: "Kurs" })
    const addon = canvas.getByRole("group", { name: "Suchsymbol" })
    const style = getComputedStyle(group)
    await expect(group.getBoundingClientRect().height).toBe(30)
    await expect(style.borderRadius).toBe("6px")
    await expect(style.paddingLeft).toBe("10px")
    await expect(style.columnGap).toBe("8px")
    await expect(style.backgroundColor).toBe(
      tokenColor(canvasElement, "--color-white"),
    )
    await expect(style.boxShadow).toContain(
      "rgba(0, 0, 0, 0.1) 0px 1px 3px 0px",
    )
    await expect(addon.getBoundingClientRect().right + 8).toBe(
      input.getBoundingClientRect().left,
    )
    await expect(getComputedStyle(input).fontSize).toBe("14px")
    await expect(getComputedStyle(input).fontWeight).toBe("500")
    await expect(getComputedStyle(input).outlineStyle).toBe("none")
    for (const length of getComputedStyle(input).boxShadow.match(
      /-?[\d.]+px/g,
    ) ?? []) {
      await expect(Number.parseFloat(length)).toBe(0)
    }
    await userEvent.type(input, "Mikroökonomie")
    await expect(input).toHaveValue("Mikroökonomie")
  },
}

export const Focus: Story = {
  ...InlineStart,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole("group", { name: "Kurssuche" })
    const input = canvas.getByRole("textbox", { name: "Kurs" })
    await userEvent.click(canvas.getByRole("group", { name: "Suchsymbol" }))
    await expect(input).toHaveFocus()
    await expect(getComputedStyle(group).boxShadow).toContain(
      tokenColor(canvasElement, "--primary-400"),
    )
    await expect(getComputedStyle(group).boxShadow).toContain("0px 0px 0px 6px")
    for (const length of getComputedStyle(input).boxShadow.match(
      /-?[\d.]+px/g,
    ) ?? []) {
      await expect(Number.parseFloat(length)).toBe(0)
    }
    input.blur()
    await expect(getComputedStyle(group).boxShadow).not.toContain(
      tokenColor(canvasElement, "--primary-400"),
    )
  },
}

export const InlineEnd: Story = {
  render: () => (
    <InputGroup aria-label="Lerndauer">
      <InputGroupAddon align="inline-end">
        <InputGroupText>Minuten</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Dauer" defaultValue="15" />
    </InputGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole("textbox", { name: "Dauer" })
    const suffix = canvas.getByText("Minuten")
    await expect(input.getBoundingClientRect().right + 8).toBe(
      suffix.getBoundingClientRect().left,
    )
    await expect(getComputedStyle(suffix).color).toBe(
      tokenColor(canvasElement, "--base-500"),
    )
    await userEvent.click(suffix)
    await expect(input).toHaveFocus()
  },
}

export const WithButton: Story = {
  render: function WithButton() {
    const [label, setLabel] = useState("Kopieren")
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setLabel("Gesendet")
        }}
      >
        <InputGroup aria-label="Notiz">
          <InputGroupInput
            aria-label="Notiztext"
            defaultValue="Prüfungsnotizen"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={() => setLabel("Kopiert")}>
              {label}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole("group", { name: "Notiz" })
    const input = canvas.getByRole("textbox", { name: "Notiztext" })
    const button = canvas.getByRole("button", { name: "Kopieren" })
    await userEvent.click(input)
    await userEvent.tab()
    await expect(button).toHaveFocus()
    await expect(button.getBoundingClientRect().height).toBe(26)
    await expect(getComputedStyle(button).boxShadow).toContain(
      tokenColor(canvasElement, "--primary-500"),
    )
    await expect(getComputedStyle(group).boxShadow).not.toContain(
      tokenColor(canvasElement, "--primary-400"),
    )
    await userEvent.click(button)
    await expect(canvas.getByRole("button", { name: "Kopiert" })).toHaveFocus()
  },
}

export const BlockEnd: Story = {
  render: () => (
    <InputGroup aria-label="Lernnotiz">
      <InputGroupAddon align="block-end" aria-label="Aktionen">
        <InputGroupText>Notiz</InputGroupText>
        <InputGroupButton className="ml-auto" variant="primary">
          Senden
        </InputGroupButton>
      </InputGroupAddon>
      <InputGroupTextarea
        aria-label="Notiztext"
        placeholder="Fasse die wichtigsten Themen zusammen …"
      />
    </InputGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole("group", { name: "Lernnotiz" })
    const textarea = canvas.getByRole("textbox", { name: "Notiztext" })
    const addon = canvas.getByRole("group", { name: "Aktionen" })
    await expect(group.getBoundingClientRect().height).toBe(104)
    await expect(textarea.getBoundingClientRect().height).toBe(64)
    await expect(addon.getBoundingClientRect().top).toBe(
      textarea.getBoundingClientRect().bottom,
    )
    await expect(getComputedStyle(textarea).resize).toBe("none")
    await expect(getComputedStyle(textarea).outlineStyle).toBe("none")
    await userEvent.click(canvas.getByText("Notiz"))
    await expect(textarea).toHaveFocus()
    await expect(getComputedStyle(group).boxShadow).toContain(
      tokenColor(canvasElement, "--primary-400"),
    )
    for (const length of getComputedStyle(textarea).boxShadow.match(
      /-?[\d.]+px/g,
    ) ?? []) {
      await expect(Number.parseFloat(length)).toBe(0)
    }
    await userEvent.type(
      textarea,
      "Erste Zeile{Enter}Zweite Zeile{Enter}Dritte Zeile{Enter}Vierte Zeile",
    )
    await expect(group.getBoundingClientRect().height).toBe(136)
    await expect(textarea).toHaveValue(
      "Erste Zeile\nZweite Zeile\nDritte Zeile\nVierte Zeile",
    )
    await userEvent.clear(textarea)
    await expect(group.getBoundingClientRect().height).toBe(104)
  },
}

export const BlockStart: Story = {
  render: () => (
    <InputGroup aria-label="Lernnotiz">
      <InputGroupTextarea
        aria-label="Notiztext"
        placeholder="Halte deine Gedanken fest …"
      />
      <InputGroupAddon align="block-start" aria-label="Überschrift">
        <InputGroupText>Lernnotiz</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole("group", { name: "Lernnotiz" })
    const textarea = canvas.getByRole("textbox", { name: "Notiztext" })
    const addon = canvas.getByRole("group", { name: "Überschrift" })
    await expect(addon.getBoundingClientRect().bottom).toBe(
      textarea.getBoundingClientRect().top,
    )
    await expect(addon.getBoundingClientRect().height).toBe(30)
    await expect(group.getBoundingClientRect().height).toBe(94)
    await userEvent.click(canvas.getByText("Lernnotiz"))
    await expect(textarea).toHaveFocus()
  },
}

export const Invalid: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <InputGroup aria-label="Kurssuche">
        <InputGroupInput
          aria-label="Kurs"
          aria-invalid="true"
          defaultValue="Unbekannter Kurs"
        />
      </InputGroup>
      <InputGroup aria-label="Lernnotiz">
        <InputGroupTextarea
          aria-label="Notiztext"
          aria-invalid="true"
          defaultValue="Diese Notiz ist ungültig."
        />
      </InputGroup>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const [groupName, controlName] of [
      ["Kurssuche", "Kurs"],
      ["Lernnotiz", "Notiztext"],
    ]) {
      const group = canvas.getByRole("group", { name: groupName })
      const control = canvas.getByRole("textbox", { name: controlName })
      const invalidColor = tokenColor(canvasElement, "--destructive-500")
      await expect(getComputedStyle(group).boxShadow).toContain(invalidColor)
      await userEvent.click(control)
      await expect(getComputedStyle(group).boxShadow).toContain(invalidColor)
      await expect(getComputedStyle(group).boxShadow).not.toContain(
        tokenColor(canvasElement, "--primary-400"),
      )
      for (const length of getComputedStyle(control).boxShadow.match(
        /-?[\d.]+px/g,
      ) ?? []) {
        await expect(Number.parseFloat(length)).toBe(0)
      }
    }
  },
}

export const Disabled: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <InputGroup aria-label="Kurssuche">
        <InputGroupAddon aria-label="Suchsymbol">
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Kurs"
          disabled
          defaultValue="Mikroökonomie"
        />
      </InputGroup>
      <InputGroup aria-label="Lernnotiz">
        <InputGroupTextarea
          aria-label="Notiztext"
          disabled
          defaultValue="Die Eingabe ist deaktiviert."
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton disabled variant="primary">
            Senden
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const [groupName, controlName] of [
      ["Kurssuche", "Kurs"],
      ["Lernnotiz", "Notiztext"],
    ]) {
      const group = canvas.getByRole("group", { name: groupName })
      const control = canvas.getByRole("textbox", { name: controlName })
      await expect(control).toBeDisabled()
      await expect(getComputedStyle(group).opacity).toBe("0.5")
      await expect(getComputedStyle(control).opacity).toBe("1")
      control.focus()
      await expect(control).not.toHaveFocus()
    }
    const send = canvas.getByRole("button", { name: "Senden" })
    await expect(send).toBeDisabled()
    await expect(getComputedStyle(send).opacity).toBe("1")
    await userEvent.click(canvas.getByRole("group", { name: "Suchsymbol" }))
    await expect(
      canvas.getByRole("textbox", { name: "Kurs" }),
    ).not.toHaveFocus()
  },
}

export const BlockInput: Story = {
  render: () => (
    <InputGroup aria-label="Website">
      <InputGroupInput
        aria-label="Adresse"
        defaultValue="https://example.com"
      />
      <InputGroupAddon align="block-start">
        <InputGroupText>Website</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole("group", { name: "Website" })
    const input = canvas.getByRole("textbox", { name: "Adresse" })
    await expect(input.getBoundingClientRect().height).toBe(30)
    await expect(group.getBoundingClientRect().height).toBe(60)
    await expect(getComputedStyle(input).paddingLeft).toBe("10px")
    await userEvent.type(input, "{End}/kurse")
    await expect(input).toHaveValue("https://example.com/kurse")
  },
}

export const NarrowComposer: Story = {
  render: () => (
    <div className="w-[342px] max-w-full">
      <InputGroup aria-label="Nachricht" className="rounded-lg">
        <InputGroupTextarea
          aria-label="Nachrichtentext"
          className="min-h-12 px-4 py-3 text-base leading-6 font-normal"
          defaultValue={
            "Erkläre mir die wichtigsten\nGrundlagen der Mikroökonomie."
          }
        />
        <InputGroupAddon
          align="block-end"
          aria-label="Aktionen"
          className="h-14 px-3 py-3"
        >
          <InputGroupButton aria-label="Hinzufügen" size="icon">
            <Plus aria-hidden="true" />
          </InputGroupButton>
          <InputGroupButton
            aria-label="Senden"
            variant="primary"
            size="icon"
            className="ml-auto"
          >
            <Send aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole("group", { name: "Nachricht" })
    const textarea = canvas.getByRole("textbox", { name: "Nachrichtentext" })
    const addon = canvas.getByRole("group", { name: "Aktionen" })
    await expect(group.getBoundingClientRect().width).toBe(342)
    await expect(getComputedStyle(group).borderRadius).toBe("8px")
    await expect(getComputedStyle(textarea).fontSize).toBe("16px")
    await expect(getComputedStyle(textarea).fontWeight).toBe("400")
    await expect(addon.getBoundingClientRect().height).toBe(56)
    await expect(group.getBoundingClientRect().height).toBe(128)
    await expect(group.scrollWidth).toBe(group.clientWidth)
    await expect(textarea.scrollWidth).toBe(textarea.clientWidth)
  },
}

export const Controlled: Story = {
  render: function Controlled() {
    const [value, setValue] = useState("Mikroökonomie")
    return (
      <InputGroup aria-label="Lernnotiz">
        <InputGroupTextarea
          aria-label="Notiztext"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton onClick={() => setValue("")}>
            Leeren
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByRole("textbox", { name: "Notiztext" })
    await userEvent.type(textarea, "{End}{Enter}Übungsfragen")
    await expect(textarea).toHaveValue("Mikroökonomie\nÜbungsfragen")
    await userEvent.click(canvas.getByRole("button", { name: "Leeren" }))
    await expect(textarea).toHaveValue("")
  },
}
