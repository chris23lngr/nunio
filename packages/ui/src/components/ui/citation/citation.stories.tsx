import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Citation, CitationList } from "./citation.js"

const meta = {
  title: "Components/new/Citation",
  component: Citation,
  args: {
    tag: "S1",
    title: "Grundlagen der BWL",
    description: "Seite 12",
    href: "/sources/bwl?page=12",
  },
} satisfies Meta<typeof Citation>
export default meta
type Story = StoryObj<typeof meta>
export const Preview: Story = {
  render: (args) => (
    <p className="text-base-800 max-w-sm">
      Fixkosten bleiben bei veränderter Produktionsmenge gleich.{" "}
      <Citation {...args} />
    </p>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("button", {
      name: "Quelle S1: Grundlagen der BWL",
    })
    await userEvent.hover(trigger)
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(page.getByText("Seite 12")).toBeVisible())
    await expect(
      page.getByRole("link", { name: "Quelle öffnen" }),
    ).toHaveAttribute("href", "/sources/bwl?page=12")
    await userEvent.keyboard("{Escape}")
    await userEvent.unhover(trigger)
    await waitFor(() =>
      expect(page.queryByText("Seite 12")).not.toBeInTheDocument(),
    )
    trigger.focus()
    await expect(trigger).toHaveFocus()
    await waitFor(() => expect(page.getByText("Seite 12")).toBeVisible())
  },
}
export const DeletedSource: Story = {
  args: {
    title: "Quelle gelöscht",
    description: "Diese Quelle ist nicht mehr verfügbar.",
    href: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(canvas.getByRole("button"))
    const page = within(canvasElement.ownerDocument.body)
    await expect(
      await page.findByText("Diese Quelle ist nicht mehr verfügbar."),
    ).toBeVisible()
    await expect(page.queryByRole("link")).not.toBeInTheDocument()
  },
}
export const Sources: Story = {
  render: () => (
    <CitationList aria-label="Verwendete Quellen">
      <Citation
        tag="S1"
        title="Grundlagen der BWL"
        description="Seite 12"
        href="/sources/bwl?page=12"
      />
      <Citation
        tag="S2"
        title="Dein eigener Eintrag"
        description="Von dir ergänzt"
      />
    </CitationList>
  ),
}

export const TapToPreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.pointer([
      { keys: "[TouchA>]", target: canvas.getByRole("button") },
      { keys: "[/TouchA]" },
    ])
    const page = within(canvasElement.ownerDocument.body)
    await expect(
      await page.findByRole("link", { name: "Quelle öffnen" }),
    ).toBeVisible()
  },
}
