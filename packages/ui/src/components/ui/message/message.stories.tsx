import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, userEvent, within } from "storybook/test"
import { Bubble, BubbleContent } from "../bubble/bubble.js"
import { Button } from "../button/button.js"
import { MdxContent } from "../mdx/mdx.js"
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageGroup,
} from "./message.js"

const meta = {
  title: "Components/new/Message",
  component: Message,
} satisfies Meta<typeof Message>
export default meta
type Story = StoryObj<typeof meta>
export const Conversation: Story = {
  render: function Conversation() {
    const [copied, setCopied] = useState(false)
    return (
      <MessageGroup className="text-base-800 w-[640px] max-w-full gap-8">
        <Message align="end" aria-label="Deine Nachricht">
          <MessageContent>
            <Bubble variant="tinted" align="end">
              <BubbleContent>Was sind Fixkosten?</BubbleContent>
            </Bubble>
            <MessageFooter>
              <time dateTime="2026-11-10T14:00:00Z">15:00 Uhr</time>
            </MessageFooter>
          </MessageContent>
        </Message>
        <Message aria-label="Antwort von nunio">
          <MessageContent>
            <Bubble variant="ghost">
              <BubbleContent>
                <MdxContent content="**Fixkosten** bleiben unabhängig von der Produktionsmenge gleich.\n\nBeispiel: die monatliche Miete." />
              </BubbleContent>
            </Bubble>
            <MessageFooter>
              <Button variant="ghost" size="sm" onClick={() => setCopied(true)}>
                Antwort kopieren
              </Button>
              <span role="status">{copied ? "Kopiert" : ""}</span>
            </MessageFooter>
          </MessageContent>
        </Message>
      </MessageGroup>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const question = canvas.getByLabelText("Deine Nachricht")
    const answer = canvas.getByLabelText("Antwort von nunio")
    await expect(
      within(question).getByText("Was sind Fixkosten?"),
    ).toBeVisible()
    await expect(within(answer).getByText("Fixkosten").tagName).toBe("STRONG")
    await expect(canvas.getByText("15:00 Uhr")).toHaveAttribute(
      "datetime",
      "2026-11-10T14:00:00Z",
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Antwort kopieren" }),
    )
    await expect(canvas.getByRole("status")).toHaveTextContent("Kopiert")
  },
}
