import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "../button/button.js"
import { Reasoning } from "./reasoning.js"

const meta = {
  title: "Components/new/Reasoning",
  component: Reasoning,
  args: { children: "" },
  decorators: [
    (Story) => (
      <div className="w-96 max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Reasoning>
export default meta
type Story = StoryObj<typeof meta>
export const Streaming: Story = {
  render: function Stream() {
    const [streaming, setStreaming] = useState(true)
    const [text, setText] = useState(
      "Ich vergleiche die Begriffe mit deinen Kursmaterialien.",
    )
    return (
      <div className="space-y-6">
        <Reasoning streaming={streaming}>{text}</Reasoning>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setText(
                `${text}\nDas Beispiel auf Seite 12 erklärt den Unterschied.`,
              )
            }
          >
            Weiterdenken
          </Button>
          <Button onClick={() => setStreaming(false)}>Abschließen</Button>
        </div>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("button", { name: "Denkt nach …" }),
    ).toHaveAttribute("aria-expanded", "true")
    await expect(
      getComputedStyle(canvas.getByText("Denkt nach …")).animationName,
    ).toBe("tw-shimmer")
    await expect(
      canvas.getByText(
        "Ich vergleiche die Begriffe mit deinen Kursmaterialien.",
      ),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Weiterdenken" }))
    await expect(canvas.getByText(/Das Beispiel auf Seite 12/)).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Abschließen" }))
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Gedankengang" }),
      ).toHaveAttribute("aria-expanded", "false"),
    )
    await userEvent.click(canvas.getByRole("button", { name: "Gedankengang" }))
    await expect(canvas.getByText(/Das Beispiel auf Seite 12/)).toBeVisible()
  },
}

export const ReaderControlsExpansion: Story = {
  ...Streaming,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("button", { name: "Denkt nach …" })
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await userEvent.click(canvas.getByRole("button", { name: "Weiterdenken" }))
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await userEvent.click(trigger)
    await userEvent.click(canvas.getByRole("button", { name: "Abschließen" }))
    await expect(
      canvas.getByRole("button", { name: "Gedankengang" }),
    ).toHaveAttribute("aria-expanded", "true")
  },
}

export const WaitingForText: Story = {
  args: { streaming: true, children: "" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("status")).toHaveTextContent("Denkt nach …")
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument()
    const title = getComputedStyle(canvas.getByText("Denkt nach …"))
    await expect(title.animationName).toBe("tw-shimmer")
    await expect(title.backgroundClip).toBe("text")
  },
}

export const Completed: Story = {
  args: {
    streaming: false,
    duration: 5,
    children:
      "Zuerst vergleiche ich die Definitionen.\nDann prüfe ich das Beispiel auf Seite 12.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("button", { name: "Gedankengang 5 s" })
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(canvas.getByText(/Zuerst vergleiche/)).toBeVisible()
    const title = getComputedStyle(canvas.getByText("Gedankengang"))
    await expect(title.animationName).toBe("none")
    await expect(title.backgroundClip).not.toBe("text")
  },
}
