import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "../button/button.js"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./message-scroller.js"

const meta = {
  title: "Components/new/MessageScroller",
  component: MessageScroller,
} satisfies Meta<typeof MessageScroller>
export default meta
type Story = StoryObj<typeof meta>

export const Following: Story = {
  render: function Thread() {
    const [count, setCount] = useState(12)
    return (
      <div className="text-base-800 w-96 max-w-full">
        <Button onClick={() => setCount(count + 1)}>Antwort ergänzen</Button>
        <div className="mt-4 h-64">
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller>
              <MessageScrollerViewport aria-label="Nachrichten">
                <MessageScrollerContent>
                  {Array.from(
                    { length: count },
                    (_, i) => `Lernnotiz ${i + 1}`,
                  ).map((note) => (
                    <MessageScrollerItem key={note} messageId={note}>
                      <p className="h-20 p-4">{note}</p>
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton
                aria-label="Zur neuesten Nachricht"
                behavior="instant"
              />
            </MessageScroller>
          </MessageScrollerProvider>
        </div>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const viewport = canvas.getByRole("region", { name: "Nachrichten" })
    const atEnd = () =>
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 5
    await waitFor(() => expect(atEnd()).toBe(true))
    await userEvent.click(
      canvas.getByRole("button", { name: "Antwort ergänzen" }),
    )
    await waitFor(() => expect(atEnd()).toBe(true))
    viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
    )
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event("scroll"))
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Zur neuesten Nachricht" }),
      ).toBeVisible(),
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Antwort ergänzen" }),
    )
    await expect(viewport.scrollTop).toBe(0)
    await userEvent.click(
      canvas.getByRole("button", { name: "Zur neuesten Nachricht" }),
    )
    await waitFor(() => expect(atEnd()).toBe(true))
  },
}
