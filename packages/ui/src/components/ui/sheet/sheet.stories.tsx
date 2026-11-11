import type { Meta, StoryObj } from "@storybook/react-vite"
import type * as React from "react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "../button/button.js"
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet.js"

const meta = {
  title: "Components/new/Sheet",
  component: SheetContent,
  args: { side: "right", showCloseButton: true },
  argTypes: {
    side: { control: "select", options: ["top", "right", "bottom", "left"] },
  },
  render: (args) => <Demo {...args} />,
} satisfies Meta<typeof SheetContent>
export default meta

type Story = StoryObj<typeof meta>

const materials = Array.from(
  { length: 40 },
  (_, index) => `Course material ${index + 1}`,
)

function Demo({
  longContent = false,
  ...props
}: React.ComponentProps<typeof SheetContent> & { longContent?: boolean }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>
        Open sheet
      </SheetTrigger>
      <SheetContent {...props}>
        <SheetHeader>
          <SheetTitle>Course details</SheetTitle>
          <SheetDescription>
            Review the materials for this Course.
          </SheetDescription>
        </SheetHeader>
        <SheetBody role="region" aria-label="Sheet content">
          {longContent ? (
            materials.map((material) => (
              <p key={material} className="mb-4">
                {material}
              </p>
            ))
          ) : (
            <p>Sheet content</p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button>Save changes</Button>
          <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export const Right: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Open sheet",
    })
    await userEvent.click(trigger)
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Course details",
    })
    await waitFor(() =>
      expect(dialog.getBoundingClientRect().width).toBe(
        window.innerWidth >= 1024 ? 640 : window.innerWidth * 0.75,
      ),
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Schließen" }),
    )
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  },
}

export const ScrollableBody: Story = {
  render: (args) => <Demo {...args} longContent />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Open sheet" }),
    )
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Course details",
    })
    const content = within(dialog).getByRole("region", {
      name: "Sheet content",
    })
    const title = within(dialog).getByRole("heading", {
      name: "Course details",
    })
    const cancel = within(dialog).getByRole("button", { name: "Cancel" })
    await waitFor(() =>
      expect(content.scrollHeight).toBeGreaterThan(content.clientHeight),
    )
    const titleTop = title.getBoundingClientRect().top
    const footerTop = cancel.getBoundingClientRect().top
    content.scrollTop = content.scrollHeight
    await expect(content.scrollTop).toBeGreaterThan(0)
    await expect(title.getBoundingClientRect().top).toBe(titleTop)
    await expect(cancel.getBoundingClientRect().top).toBe(footerTop)
    await expect(footerTop).toBeLessThan(window.innerHeight)
    await userEvent.click(cancel)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  },
}

export const Left: Story = { ...Right, args: { side: "left" } }

export const Top: Story = { ...ScrollableBody, args: { side: "top" } }

export const Bottom: Story = { ...ScrollableBody, args: { side: "bottom" } }

export const Appearance: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Open sheet" }),
    )
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Course details",
    })
    const title = within(dialog).getByRole("heading", {
      name: "Course details",
    })
    const description = within(dialog).getByText(
      "Review the materials for this Course.",
    )
    const content = within(dialog).getByRole("region", {
      name: "Sheet content",
    })
    const save = within(dialog).getByRole("button", { name: "Save changes" })
    const cancel = within(dialog).getByRole("button", { name: "Cancel" })
    const overlay = document.querySelector(
      '[data-slot="sheet-overlay"]',
    ) as HTMLElement
    await expect(getComputedStyle(title).fontSize).toBe("18px")
    await expect(getComputedStyle(title).lineHeight).toBe("28px")
    await expect(getComputedStyle(description).lineHeight).toBe("20px")
    await expect(getComputedStyle(dialog).boxShadow).toBe("none")
    await expect(getComputedStyle(dialog).borderLeftWidth).toBe("0px")
    await expect(getComputedStyle(overlay).backdropFilter).toBe("none")
    await waitFor(() =>
      expect(
        title.getBoundingClientRect().top - dialog.getBoundingClientRect().top,
      ).toBe(32),
    )
    await expect(
      title.getBoundingClientRect().left - dialog.getBoundingClientRect().left,
    ).toBe(24)
    await expect(
      description.getBoundingClientRect().top -
        title.getBoundingClientRect().bottom,
    ).toBe(4)
    await expect(
      content.getBoundingClientRect().top -
        description.getBoundingClientRect().bottom,
    ).toBe(32)
    await expect(
      cancel.getBoundingClientRect().top - save.getBoundingClientRect().bottom,
    ).toBe(16)
    await expect(save.getBoundingClientRect().width).toBe(
      dialog.getBoundingClientRect().width - 48,
    )
    await expect(cancel.getBoundingClientRect().width).toBe(
      save.getBoundingClientRect().width,
    )
    await userEvent.click(cancel)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  },
}

export const Interactions: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Open sheet",
    })
    const body = within(document.body)
    await userEvent.click(trigger)
    const dialog = await body.findByRole("dialog", { name: "Course details" })
    await expect(dialog).toHaveAccessibleDescription(
      "Review the materials for this Course.",
    )
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    )
    const cancel = within(dialog).getByRole("button", { name: "Cancel" })
    cancel.focus()
    await userEvent.tab()
    await userEvent.tab()
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    )
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await expect(trigger).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    const reopened = await body.findByRole("dialog", { name: "Course details" })
    await userEvent.click(
      within(reopened).getByRole("button", { name: "Schließen" }),
    )
    await waitFor(() => expect(reopened).not.toBeInTheDocument())
    await expect(trigger).toHaveFocus()
  },
}

export const NoCloseButton: Story = {
  args: { showCloseButton: false },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Open sheet" }),
    )
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Course details",
    })
    await expect(
      within(dialog).queryByRole("button", { name: "Schließen" }),
    ).not.toBeInTheDocument()
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    )
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  },
}
