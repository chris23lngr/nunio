import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { Approval } from "./approval.js"

const meta = {
  title: "Components/new/Approval",
  component: Approval,
  args: {
    title: "Lernblock verschieben?",
    description: "BWL · Dienstag, 10:00–11:00 → Mittwoch, 14:00–15:00",
    children:
      "Diese Anfrage gilt nur für diesen Lernblock und läuft heute um 18:00 Uhr ab.",
    approveLabel: "Verschiebung erlauben",
    denyLabel: "Nicht verschieben",
    onDecide: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[480px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Approval>
export default meta
type Story = StoryObj<typeof meta>
export const Pending: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("heading", { name: "Lernblock verschieben?" }),
    ).toBeVisible()
    await expect(
      canvas.getByText("BWL · Dienstag, 10:00–11:00 → Mittwoch, 14:00–15:00"),
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Verschiebung erlauben" }),
    )
    await expect(args.onDecide).toHaveBeenCalledWith("approve")
    await userEvent.click(
      canvas.getByRole("button", { name: "Nicht verschieben" }),
    )
    await expect(args.onDecide).toHaveBeenCalledWith("deny")
  },
}

export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    for (const button of canvas.getAllByRole("button")) {
      await expect(button).toBeDisabled()
      button.click()
    }
    await expect(args.onDecide).not.toHaveBeenCalled()
  },
}
