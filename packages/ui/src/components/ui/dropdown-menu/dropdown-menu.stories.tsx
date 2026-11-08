import type { Meta, StoryObj } from "@storybook/react-vite"
import { Share, SquarePen, Trash } from "lucide-react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Button } from "../button/button.js"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.js"

const meta = {
  title: "Components/new/DropdownMenu",
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>
export default meta

type Story = StoryObj<typeof meta>

function ActionMenu({
  icons = true,
  triggerClassName = "w-62",
}: {
  icons?: boolean
  triggerClassName?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className={triggerClassName} />}
      >
        Aktionen
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group</DropdownMenuLabel>
          <DropdownMenuItem>
            {icons && <SquarePen />}Bearbeiten
            <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>{icons && <Share />}Teilen</DropdownMenuItem>
          <DropdownMenuItem disabled>Nicht verfügbar</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive">
            {icons && <Trash />}Löschen
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function tokenColor(token: string) {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  document.body.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

async function openMenu(canvasElement: HTMLElement) {
  const trigger = within(canvasElement).getByRole("button", {
    name: "Aktionen",
  })
  await userEvent.click(trigger)
  const menu = await within(document.body).findByRole("menu")
  await waitFor(() => expect(menu).toHaveFocus())
  return { trigger, menu, items: within(menu) }
}

export const Playground: Story = { render: () => <ActionMenu /> }

export const ContentSizedTrigger: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "The trigger fits its label. The menu grows to fit its items while remaining at least as wide as the trigger and the 128px minimum.",
      },
    },
  },
  render: () => <ActionMenu triggerClassName="w-fit" />,
  play: async ({ canvasElement }) => {
    const { trigger, menu } = await openMenu(canvasElement)
    await expect(trigger.getBoundingClientRect().width).toBeLessThan(128)
    await expect(menu.getBoundingClientRect().width).toBeGreaterThanOrEqual(128)
    for (const item of within(menu).getAllByRole("menuitem")) {
      await expect(item.getBoundingClientRect().height).toBe(28)
      await expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth)
      await expect(item.getBoundingClientRect().right).toBeLessThanOrEqual(
        menu.getBoundingClientRect().right,
      )
    }
    const shortcut = menu.querySelector("[data-slot=dropdown-menu-shortcut]")
    if (!shortcut) throw new Error("Missing shortcut")
    await expect(shortcut.getBoundingClientRect().right).toBeLessThanOrEqual(
      menu.getBoundingClientRect().right,
    )
  },
}

export const WithIcons: Story = {
  render: () => <ActionMenu />,
  play: async ({ canvasElement }) => {
    const { trigger, menu, items } = await openMenu(canvasElement)
    await expect(menu.getBoundingClientRect().width).toBe(
      trigger.getBoundingClientRect().width,
    )
    await expect(getComputedStyle(menu).borderRadius).toBe("8px")
    await expect(getComputedStyle(menu).animationName).toBe("none")
    await expect(getComputedStyle(menu).transitionDuration).toBe("0s")
    const edit = items.getByRole("menuitem", { name: /Bearbeiten/ })
    const style = getComputedStyle(edit)
    await expect(edit.getBoundingClientRect().height).toBe(28)
    await expect([style.paddingLeft, style.paddingRight, style.gap]).toEqual([
      "6px",
      "6px",
      "8px",
    ])
    await expect(style.fontWeight).toBe("500")
    await expect(style.color).toBe(tokenColor("--base-700"))
    const icon = edit.querySelector("svg")
    if (!icon) throw new Error("Missing menu icon")
    await expect(icon.getBoundingClientRect().width).toBe(16)
    await expect(getComputedStyle(icon).color).toBe(tokenColor("--base-500"))
    const shortcut = edit.querySelector("[data-slot=dropdown-menu-shortcut]")
    if (!shortcut) throw new Error("Missing shortcut")
    await expect(getComputedStyle(shortcut).fontSize).toBe("14px")
    await expect(getComputedStyle(shortcut).fontWeight).toBe("400")
    const disabled = items.getByRole("menuitem", { name: "Nicht verfügbar" })
    await expect(disabled).toHaveAttribute("aria-disabled", "true")
    await expect(getComputedStyle(disabled).opacity).toBe("0.5")
    const separator = items.getByRole("separator")
    await expect(separator.getBoundingClientRect().width).toBe(
      menu.getBoundingClientRect().width,
    )
    await expect(separator.getBoundingClientRect().height).toBe(1)
    await userEvent.click(edit)
    await waitFor(() =>
      expect(within(document.body).queryByRole("menu")).toBeNull(),
    )
    await expect(trigger).toHaveFocus()
  },
}

export const WithoutIcons: Story = {
  render: () => <ActionMenu icons={false} />,
  play: async ({ canvasElement }) => {
    const { items } = await openMenu(canvasElement)
    const edit = items.getByRole("menuitem", { name: /Bearbeiten/ })
    await expect(edit.querySelector("svg")).toBeNull()
    await expect(getComputedStyle(edit).paddingLeft).toBe("6px")
    await expect(getComputedStyle(edit).paddingRight).toBe("6px")
  },
}

export const HighlightStates: Story = {
  render: () => <ActionMenu />,
  play: async ({ canvasElement }) => {
    const { trigger, menu, items } = await openMenu(canvasElement)
    const edit = items.getByRole("menuitem", { name: /Bearbeiten/ })
    const share = items.getByRole("menuitem", { name: "Teilen" })
    const remove = items.getByRole("menuitem", { name: "Löschen" })
    await expect(getComputedStyle(remove).color).toBe(tokenColor("--base-700"))
    await userEvent.keyboard("{ArrowDown}")
    await waitFor(() =>
      expect(edit, "first keyboard highlight").toHaveAttribute(
        "data-highlighted",
      ),
    )
    await expect(getComputedStyle(edit).backgroundColor).toBe(
      tokenColor("--base-100"),
    )
    await expect(getComputedStyle(edit).boxShadow).toBe("none")
    await userEvent.keyboard("{ArrowDown}{ArrowDown}")
    const disabled = items.getByRole("menuitem", { name: "Nicht verfügbar" })
    // Base UI allows disabled items to be discovered by keyboard, but not activated.
    await waitFor(() => expect(disabled).toHaveFocus())
    await userEvent.keyboard("{Enter}")
    await expect(menu).toBeVisible()
    await userEvent.keyboard("{ArrowDown}")
    await waitFor(() =>
      expect(remove, "destructive keyboard highlight").toHaveAttribute(
        "data-highlighted",
      ),
    )
    await expect(getComputedStyle(remove).backgroundColor).toBe(
      tokenColor("--destructive-50"),
    )
    await expect(getComputedStyle(remove).color).toBe(
      tokenColor("--destructive-800"),
    )
    await expect(getComputedStyle(remove).boxShadow).toBe("none")
    await userEvent.hover(share)
    await waitFor(() =>
      expect(share, "pointer highlight").toHaveAttribute("data-highlighted"),
    )
    await expect(getComputedStyle(share).backgroundColor).toBe(
      tokenColor("--base-100"),
    )
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(within(document.body).queryByRole("menu")).toBeNull(),
    )
    await expect(trigger).toHaveFocus()
  },
}

export const Checkboxes: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="w-62" />}
      >
        Aktionen
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Checkboxes</DropdownMenuLabel>
          <DropdownMenuCheckboxItem defaultChecked>
            Option 1
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Option 2</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem disabled>Option 3</DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    const { menu, items } = await openMenu(canvasElement)
    const first = items.getByRole("menuitemcheckbox", { name: "Option 1" })
    const second = items.getByRole("menuitemcheckbox", { name: "Option 2" })
    await expect(first).toHaveAttribute("aria-checked", "true")
    await userEvent.click(second)
    await expect(menu).toBeVisible()
    await expect(first).toHaveAttribute("aria-checked", "true")
    await expect(second).toHaveAttribute("aria-checked", "true")
    const check = second.querySelector("svg")
    if (!check) throw new Error("Missing checkmark")
    await expect(getComputedStyle(check).color).toBe(tokenColor("--base-600"))
    await expect(
      second.getBoundingClientRect().right -
        check.getBoundingClientRect().right,
    ).toBe(6)
    await userEvent.click(second)
    await expect(second).toHaveAttribute("aria-checked", "false")
    await expect(second.querySelector("svg")).toBeNull()
    const disabled = items.getByRole("menuitemcheckbox", { name: "Option 3" })
    disabled.click()
    await expect(disabled).toHaveAttribute("aria-checked", "false")
  },
}

export const RadioItems: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="w-62" />}
      >
        Aktionen
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup defaultValue="one">
          <DropdownMenuLabel>Radio options</DropdownMenuLabel>
          <DropdownMenuRadioItem value="one">Option 1</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="two">Option 2</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="three" disabled>
            Option 3
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    const { menu, items } = await openMenu(canvasElement)
    const first = items.getByRole("menuitemradio", { name: "Option 1" })
    const second = items.getByRole("menuitemradio", { name: "Option 2" })
    await expect(first).toHaveAttribute("aria-checked", "true")
    await userEvent.click(second)
    await expect(menu).toBeVisible()
    await expect(first).toHaveAttribute("aria-checked", "false")
    await expect(second).toHaveAttribute("aria-checked", "true")
    await userEvent.click(second)
    await expect(second).toHaveAttribute("aria-checked", "true")
    await expect(menu.querySelectorAll("svg")).toHaveLength(1)
  },
}

export const Submenus: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Aktionen
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Teilen</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuItem>Link kopieren</DropdownMenuItem>
                <DropdownMenuItem>E-Mail</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    const { items } = await openMenu(canvasElement)
    const subTrigger = items.getByRole("menuitem", { name: "Teilen" })
    await userEvent.keyboard("{ArrowDown}{ArrowRight}")
    const child = await within(document.body).findByRole("menuitem", {
      name: "Link kopieren",
    })
    const submenu = child.closest("[role=menu]")
    if (!submenu) throw new Error("Missing submenu")
    await expect(subTrigger).toHaveAttribute("data-popup-open")
    await expect(getComputedStyle(subTrigger).backgroundColor).toBe(
      tokenColor("--base-100"),
    )
    await expect(getComputedStyle(submenu).borderRadius).toBe("8px")
    await expect(getComputedStyle(submenu).minWidth).toBe("96px")
    await waitFor(() => expect(child).toHaveFocus())
    await userEvent.keyboard("{ArrowLeft}")
    await waitFor(() =>
      expect(subTrigger).not.toHaveAttribute("data-popup-open"),
    )
    await waitFor(() =>
      expect(within(document.body).getAllByRole("menu")).toHaveLength(1),
    )
  },
}

export const Dark: Story = {
  ...WithIcons,
  globals: { theme: "dark" },
}
