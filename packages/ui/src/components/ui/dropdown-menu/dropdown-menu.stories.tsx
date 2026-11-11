import type { Meta, StoryObj } from "@storybook/react-vite"
import { Share, SquarePen, Trash } from "lucide-react"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
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
  DropdownMenuSwitchItem,
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
    await waitFor(() => expect(second.querySelector("svg")).toBeNull())
    const disabled = items.getByRole("menuitemcheckbox", { name: "Option 3" })
    disabled.click()
    await expect(disabled).toHaveAttribute("aria-checked", "false")
  },
}

const onCourseChange = fn()

export const SwitchItems: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="w-62" />}
      >
        Aktionen
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Kurse</DropdownMenuLabel>
          <DropdownMenuSwitchItem
            defaultChecked
            onCheckedChange={onCourseChange}
          >
            Analysis I
          </DropdownMenuSwitchItem>
          <DropdownMenuSwitchItem defaultChecked>
            Lineare Algebra
          </DropdownMenuSwitchItem>
          <DropdownMenuSwitchItem>Statistik</DropdownMenuSwitchItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>Kurse verwalten</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    onCourseChange.mockClear()
    const { trigger, menu, items } = await openMenu(canvasElement)
    const analysis = items.getByRole("menuitemcheckbox", { name: "Analysis I" })
    const statistik = items.getByRole("menuitemcheckbox", { name: "Statistik" })
    await expect(
      items
        .getAllByRole("menuitemcheckbox")
        .map((item) => item.getAttribute("aria-checked")),
    ).toEqual(["true", "true", "false"])

    // Pointer toggles and keeps the menu open, like DropdownMenuCheckboxItem.
    await userEvent.click(analysis)
    await expect(analysis).toHaveAttribute("aria-checked", "false")
    await expect(onCourseChange).toHaveBeenCalledTimes(1)
    await expect(onCourseChange.mock.calls[0]?.[0]).toBe(false)
    await expect(menu).toBeVisible()

    // Keyboard: Arrow to the item, Enter and Space toggle it.
    await userEvent.keyboard("{ArrowDown}{ArrowDown}")
    await waitFor(() => expect(statistik).toHaveFocus())
    await userEvent.keyboard("{Enter}")
    await expect(statistik).toHaveAttribute("aria-checked", "true")
    await userEvent.keyboard(" ")
    await expect(statistik).toHaveAttribute("aria-checked", "false")
    await expect(menu).toBeVisible()

    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(within(document.body).queryByRole("menu")).toBeNull(),
    )
    await expect(trigger).toHaveFocus()
  },
}

function getSwitch(item: HTMLElement) {
  const track = item.querySelector<HTMLElement>(
    "[data-slot=dropdown-menu-switch-item-indicator]",
  )
  const thumb = track?.firstElementChild
  if (!track || !thumb) throw new Error("Missing switch indicator")
  return { track, thumb }
}

async function expectSwitch(item: HTMLElement, on: boolean) {
  const { track, thumb } = getSwitch(item)
  const primary = tokenColor("--primary-500")
  const white = tokenColor("--color-white")
  // Colors and thumb position transition, so wait for the settled state.
  await waitFor(() => {
    const trackStyle = getComputedStyle(track)
    expect(trackStyle.backgroundColor).toBe(on ? primary : white)
    if (on) expect(trackStyle.outlineColor).toBe(primary)
    else expect(trackStyle.outlineColor).not.toBe(primary)
    expect(getComputedStyle(thumb).backgroundColor).toBe(
      on ? white : tokenColor("--base-500"),
    )
    const t = track.getBoundingClientRect()
    const th = thumb.getBoundingClientRect()
    expect(th.top - t.top).toBeCloseTo(t.bottom - th.bottom)
    if (on) expect(t.right - th.right).toBeCloseTo(2)
    else expect(th.left - t.left).toBeCloseTo(2)
  })
}

export const SwitchItemIndicator: Story = {
  render: SwitchItems.render,
  play: async ({ canvasElement }) => {
    const { menu, items } = await openMenu(canvasElement)
    const label = items.getByText("Kurse")
    await expect(getComputedStyle(label).fontSize).toBe("12px")
    await expect(getComputedStyle(label).lineHeight).toBe("18px")
    await expect(getComputedStyle(label).color).toBe(tokenColor("--base-500"))
    const statistik = items.getByRole("menuitemcheckbox", { name: "Statistik" })
    const style = getComputedStyle(statistik)
    await expect(statistik.getBoundingClientRect().height).toBe(28)
    await expect([style.paddingLeft, style.paddingRight, style.gap]).toEqual([
      "6px",
      "6px",
      "8px",
    ])
    await expect(style.borderRadius).toBe("6px")
    await expect(style.fontSize).toBe("14px")
    await expect(style.fontWeight).toBe("500")
    await expect(style.color).toBe(tokenColor("--base-700"))

    const { track, thumb } = getSwitch(statistik)
    await expect(track).toHaveAttribute("aria-hidden", "true")
    await expect(track.getBoundingClientRect().width).toBe(22)
    await expect(track.getBoundingClientRect().height).toBe(13)
    await expect(thumb.getBoundingClientRect().width).toBe(10)
    await expect(thumb.getBoundingClientRect().height).toBe(10)
    await expect(getComputedStyle(track).borderRadius).not.toBe("0px")
    await expect(getComputedStyle(track).outlineWidth).toBe("1px")
    await expect(getComputedStyle(track).boxShadow).toContain(
      "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px",
    )
    // Trailing: the switch sits at the row's end, inside its 6px padding.
    await expect(
      statistik.getBoundingClientRect().right -
        track.getBoundingClientRect().right,
    ).toBe(6)
    // The row is the only control: nothing focusable inside it.
    await expect(
      statistik.querySelector("button, input, [tabindex]"),
    ).toBeNull()

    await expectSwitch(
      items.getByRole("menuitemcheckbox", { name: "Analysis I" }),
      true,
    )
    await expectSwitch(statistik, false)
    await userEvent.click(statistik)
    await expect(statistik).toHaveAttribute("aria-checked", "true")
    await expectSwitch(statistik, true)
    await expect(menu).toBeVisible()
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
