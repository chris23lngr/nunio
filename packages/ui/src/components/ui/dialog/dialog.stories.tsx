import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "../button/button.js"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js"

const meta = {
  title: "Components/new/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>
export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a Course</DialogTitle>
          <DialogDescription>Organize your study materials.</DialogDescription>
        </DialogHeader>
        <DialogBody>Choose the details for your new Course.</DialogBody>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Open dialog",
    })
    const body = within(document.body)
    await userEvent.click(trigger)
    const dialog = await body.findByRole("dialog", { name: "Create a Course" })
    await expect(dialog).toHaveAccessibleDescription(
      "Organize your study materials.",
    )
    await expect(getComputedStyle(dialog).transitionDuration).toBe("0.1s")
    const close = within(dialog).getByRole("button", { name: "Close" })
    await waitFor(() => expect(close).toHaveFocus())
    await userEvent.tab()
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    )
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    await userEvent.click(trigger)
    await userEvent.click(await body.findByRole("button", { name: "Close" }))
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

function PaperDialog({
  className,
  longContent = false,
}: {
  className?: string
  longContent?: boolean
}) {
  return (
    <Dialog defaultOpen>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>Create a Course</DialogTitle>
          <DialogDescription>Organize your study materials.</DialogDescription>
        </DialogHeader>
        <DialogBody data-testid="body">
          {longContent ? (
            <div className="space-y-4">
              {Array.from(
                { length: 40 },
                (_, index) => `Course material ${index + 1}`,
              ).map((material) => (
                <p key={material}>{material}: review your study resources.</p>
              ))}
            </div>
          ) : (
            <p>Add your Course details here.</p>
          )}
        </DialogBody>
        <DialogFooter data-testid="footer">
          <Button>Continue</Button>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const PaperLayout: Story = {
  render: () => <PaperDialog />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Create a Course",
    })
    const content = within(dialog)
    await waitFor(() =>
      expect(
        dialog
          .getAnimations()
          .every((animation) => animation.playState === "finished"),
      ).toBe(true),
    )
    const rect = dialog.getBoundingClientRect()
    const style = getComputedStyle(dialog)
    await expect(rect.width).toBe(Math.min(640, window.innerWidth - 32))
    await expect(style.borderRadius).toBe("16px")
    await expect(style.backgroundColor).toBe("rgb(255, 255, 255)")
    await expect(style.outlineWidth).toBe("1px")
    await expect(style.boxShadow).not.toBe("none")
    const title = content.getByRole("heading", { name: "Create a Course" })
    const description = content.getByText("Organize your study materials.")
    await expect(getComputedStyle(title).fontSize).toBe("18px")
    await expect(getComputedStyle(title).lineHeight).toBe("28px")
    await expect(getComputedStyle(title).fontWeight).toBe("500")
    await expect(
      description.getBoundingClientRect().top -
        title.getBoundingClientRect().bottom,
    ).toBe(4)
    await expect(title.getBoundingClientRect().left - rect.left).toBe(24)
    await expect(title.getBoundingClientRect().top - rect.top).toBe(32)
    const body = content.getByTestId("body")
    await expect(getComputedStyle(body).paddingLeft).toBe("24px")
    await expect(getComputedStyle(body).paddingBottom).toBe("32px")
    const footer = content.getByTestId("footer")
    await expect(getComputedStyle(footer).padding).toBe("32px 24px")
    await expect(getComputedStyle(footer).borderTopWidth).toBe("1px")
    const primary = content
      .getByRole("button", { name: "Continue" })
      .getBoundingClientRect()
    const secondary = content
      .getByRole("button", { name: "Cancel" })
      .getBoundingClientRect()
    await expect(primary.width).toBe(rect.width - 48)
    await expect(secondary.width).toBe(primary.width)
    await expect(secondary.top - primary.bottom).toBe(16)
  },
}

export const Small: Story = {
  render: () => <PaperDialog className="max-w-md" />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Create a Course",
    })
    await waitFor(() =>
      expect(
        dialog
          .getAnimations()
          .every((animation) => animation.playState === "finished"),
      ).toBe(true),
    )
    const rect = dialog.getBoundingClientRect()
    await expect(rect.width).toBe(Math.min(448, window.innerWidth - 32))
    const close = within(dialog).getByRole("button", { name: "Close" })
    const button = close.getBoundingClientRect()
    await expect(button.right).toBeLessThanOrEqual(rect.right - 24)
    await expect(button.left).toBeGreaterThan(rect.left)
    close.focus()
    await expect(close).toHaveFocus()
    const overlay = document.querySelector<HTMLElement>(
      "[data-slot=dialog-overlay]",
    )
    if (!overlay) throw new Error("Dialog overlay is missing")
    await expect(getComputedStyle(overlay).backdropFilter).toBe("none")
    const probe = document.createElement("span")
    probe.style.backgroundColor =
      "color-mix(in oklab, var(--base-800) 10%, transparent)"
    document.body.append(probe)
    try {
      await expect(getComputedStyle(overlay).backgroundColor).toBe(
        getComputedStyle(probe).backgroundColor,
      )
    } finally {
      probe.remove()
    }
  },
}

export const Scrollable: Story = {
  render: () => <PaperDialog longContent />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Create a Course",
    })
    await waitFor(() =>
      expect(
        dialog
          .getAnimations()
          .every((animation) => animation.playState === "finished"),
      ).toBe(true),
    )
    const rect = dialog.getBoundingClientRect()
    await expect(rect.top).toBeGreaterThanOrEqual(16)
    await expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight - 16)
    await expect(rect.left).toBeGreaterThanOrEqual(16)
    await expect(rect.right).toBeLessThanOrEqual(window.innerWidth - 16)
    await expect(dialog.scrollHeight).toBeGreaterThan(dialog.clientHeight)
    const cancel = within(dialog).getByRole("button", { name: "Cancel" })
    cancel.focus()
    await expect(cancel).toHaveFocus()
    await expect(dialog.scrollTop).toBeGreaterThan(0)
    const action = cancel.getBoundingClientRect()
    await expect(action.top).toBeGreaterThanOrEqual(rect.top)
    await expect(action.bottom).toBeLessThanOrEqual(rect.bottom)
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(within(document.body).queryByRole("dialog")).toBeNull(),
    )
  },
}

export const BackdropDismissal: Story = {
  ...Default,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Open dialog",
    })
    const body = within(document.body)
    await userEvent.click(trigger)
    await body.findByRole("dialog", { name: "Create a Course" })
    const overlay = document.querySelector<HTMLElement>(
      "[data-slot=dialog-overlay]",
    )
    if (!overlay) throw new Error("Dialog overlay is missing")
    await userEvent.click(overlay)
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

export const FooterCloseButton: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Course created</DialogTitle>
          <DialogDescription>
            Your Course is ready for study materials.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>You can now add your study resources.</DialogBody>
        <DialogFooter showCloseButton data-testid="footer" />
      </DialogContent>
    </Dialog>
  ),
  play: async () => {
    const body = within(document.body)
    const dialog = await body.findByRole("dialog", { name: "Course created" })
    const buttons = within(dialog).getAllByRole("button", { name: "Close" })
    await expect(buttons).toHaveLength(1)
    const close = within(dialog).getByRole("button", { name: "Close" })
    await expect(within(dialog).getByTestId("footer")).toContainElement(close)
    await userEvent.click(close)
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull())
  },
}
