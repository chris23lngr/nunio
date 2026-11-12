import type { Meta, StoryObj } from "@storybook/react-vite"
import type * as React from "react"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select.js"

const meta = {
  title: "Components/new/Select",
  component: Select,
  decorators: [
    (Story) => (
      <div className="p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Select>
export default meta

type Story = StoryObj<typeof meta>

const courses = [
  { value: "anatomy", label: "Anatomie" },
  { value: "biochemistry", label: "Biochemie" },
  { value: "physiology", label: "Physiologie" },
  { value: "psychology", label: "Medizinische Psychologie" },
]

function CourseSelect({
  size,
  invalid,
  ...props
}: React.ComponentProps<typeof Select> & {
  size?: "sm" | "default" | "lg"
  invalid?: boolean
}) {
  return (
    <Select items={courses} {...props}>
      <SelectTrigger
        size={size}
        aria-label="Kurs"
        aria-invalid={invalid}
        className="w-62"
      >
        <SelectValue placeholder="Kurs auswählen" />
      </SelectTrigger>
      <SelectContent align="start" sideOffset={8} alignItemWithTrigger={false}>
        <SelectGroup>
          {courses.map((course) => (
            <SelectItem key={course.value} value={course.value}>
              {course.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
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

async function openSelect(canvasElement: HTMLElement) {
  const trigger = within(canvasElement).getByRole("combobox", { name: "Kurs" })
  await userEvent.click(trigger)
  const list = await within(document.body).findByRole("listbox")
  await waitFor(() => expect(list.contains(document.activeElement)).toBe(true))
  return { trigger, list, options: within(list) }
}

export const Placeholder: Story = {
  render: () => <CourseSelect />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox")
    await expect(trigger).toHaveTextContent("Kurs auswählen")
    const style = getComputedStyle(trigger)
    await expect(trigger.getBoundingClientRect().height).toBe(30)
    await expect(trigger.getBoundingClientRect().width).toBe(248)
    await expect([
      style.borderRadius,
      style.paddingLeft,
      style.paddingRight,
      style.gap,
    ]).toEqual(["6px", "10px", "10px", "8px"])
    await expect([style.fontSize, style.lineHeight, style.fontWeight]).toEqual([
      "14px",
      "20px",
      "500",
    ])
    await expect(style.color).toBe(tokenColor("--base-500"))
    await expect(style.backgroundColor).toBe(tokenColor("--color-white"))
    await expect(style.transitionDuration).toBe("0s")
    await expect(
      trigger.querySelector("svg")?.getBoundingClientRect().width,
    ).toBe(16)
  },
}

const onValueChange = fn()

export const Selected: Story = {
  render: () => (
    <CourseSelect
      defaultValue="biochemistry"
      name="course"
      onValueChange={onValueChange}
    />
  ),
  play: async ({ canvasElement }) => {
    onValueChange.mockClear()
    const { trigger, list, options } = await openSelect(canvasElement)
    const popup = list.closest("[data-slot=select-content]")
    if (!popup) throw new Error("Missing Select popup")
    await expect(popup.getBoundingClientRect().width).toBe(248)
    await expect(getComputedStyle(popup).borderRadius).toBe("8px")
    await expect(
      Math.round(
        popup.getBoundingClientRect().top -
          trigger.getBoundingClientRect().bottom,
      ),
    ).toBe(8)
    const selected = options.getByRole("option", { name: "Biochemie" })
    await expect(selected).toHaveAttribute("aria-selected", "true")
    await expect(selected.getBoundingClientRect().height).toBe(28)
    await expect(getComputedStyle(selected).color).toBe(
      tokenColor("--base-700"),
    )
    const check = selected.querySelector("svg")
    if (!check) throw new Error("Missing selected indicator")
    await expect(check.getBoundingClientRect().width).toBe(16)
    await expect(getComputedStyle(check).color).toBe(tokenColor("--base-500"))
    await expect(
      selected.getBoundingClientRect().right -
        check.getBoundingClientRect().right,
    ).toBe(6)
    const physiology = options.getByRole("option", { name: "Physiologie" })
    await expect(physiology.querySelector("svg")).toBeNull()
    await userEvent.hover(physiology)
    await waitFor(() => expect(physiology).toHaveAttribute("data-highlighted"))
    await expect(getComputedStyle(physiology).backgroundColor).toBe(
      tokenColor("--base-100"),
    )
    await expect(selected).toHaveAttribute("aria-selected", "true")
    await userEvent.click(physiology)
    await waitFor(() =>
      expect(within(document.body).queryByRole("listbox")).toBeNull(),
    )
    await expect(trigger).toHaveTextContent("Physiologie")
    await expect(trigger).toHaveFocus()
    await expect(onValueChange.mock.calls[0]?.[0]).toBe("physiology")
    await expect(canvasElement.querySelector("input[name=course]")).toHaveValue(
      "physiology",
    )
  },
}

export const Focus: Story = {
  render: () => <CourseSelect defaultValue="biochemistry" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox")
    await userEvent.tab()
    trigger.focus()
    await expect(trigger).toHaveFocus()
    const style = getComputedStyle(trigger)
    await expect(style.boxShadow).toContain(tokenColor("--primary-500"))
    await expect(style.getPropertyValue("--tw-ring-offset-width")).toBe("4px")
  },
}

export const Invalid: Story = {
  render: () => <CourseSelect invalid />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox")
    await expect(trigger).toHaveAttribute("aria-invalid", "true")
    await expect(getComputedStyle(trigger).boxShadow).toContain(
      tokenColor("--destructive-500"),
    )
    await userEvent.tab()
    trigger.focus()
    await expect(getComputedStyle(trigger).boxShadow).toContain(
      tokenColor("--destructive-500"),
    )
    await expect(getComputedStyle(trigger).boxShadow).not.toContain(
      tokenColor("--primary-500"),
    )
  },
}

export const Disabled: Story = {
  render: () => <CourseSelect disabled defaultValue="biochemistry" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox")
    await expect(trigger).toBeDisabled()
    await expect(getComputedStyle(trigger).opacity).toBe("0.5")
    trigger.focus()
    await expect(trigger).not.toHaveFocus()
    await userEvent.keyboard("{ArrowDown}")
    await expect(within(document.body).queryByRole("listbox")).toBeNull()
  },
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-start gap-8">
      {(["sm", "default", "lg"] as const).map((size) => (
        <CourseSelect key={size} size={size} defaultValue="biochemistry" />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const triggers = within(canvasElement).getAllByRole("combobox")
    for (const [index, trigger] of triggers.entries()) {
      await expect(trigger.getBoundingClientRect().height).toBe(
        [26, 30, 34][index],
      )
      await expect(getComputedStyle(trigger).paddingLeft).toBe(
        ["8px", "10px", "12px"][index],
      )
    }
  },
}

export const Grouped: Story = {
  render: () => (
    <Select
      items={[...courses, { value: "internal", label: "Innere Medizin" }]}
      defaultValue="biochemistry"
    >
      <SelectTrigger aria-label="Kurs" className="w-62">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" sideOffset={8} alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectLabel>Vorklinik</SelectLabel>
          {courses.slice(0, 3).map((course) => (
            <SelectItem key={course.value} value={course.value}>
              {course.label}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Klinik</SelectLabel>
          <SelectItem value="internal" disabled>
            Innere Medizin
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement }) => {
    const { trigger, list, options } = await openSelect(canvasElement)
    const label = options.getByText("Vorklinik")
    await expect(getComputedStyle(label).lineHeight).toBe("18px")
    const separator = list.querySelector("[data-slot=select-separator]")
    if (!separator) throw new Error("Missing group separator")
    await expect(separator.getBoundingClientRect().height).toBe(1)
    await expect(separator.getBoundingClientRect().width).toBe(248)
    const disabled = options.getByRole("option", { name: "Innere Medizin" })
    await expect(disabled).toHaveAttribute("aria-disabled", "true")
    await expect(getComputedStyle(disabled).opacity).toBe("0.5")
    await userEvent.keyboard("{ArrowDown}")
    const physiology = options.getByRole("option", { name: "Physiologie" })
    await waitFor(() => expect(physiology).toHaveAttribute("data-highlighted"))
    await userEvent.keyboard("{End}")
    // Base UI keeps disabled options discoverable, but prevents selection.
    await waitFor(() => expect(disabled).toHaveFocus())
    await userEvent.keyboard("{Enter}")
    await expect(list).toBeVisible()
    await expect(disabled).toHaveAttribute("aria-selected", "false")
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(within(document.body).queryByRole("listbox")).toBeNull(),
    )
    await expect(trigger).toHaveFocus()
    await userEvent.keyboard("{ArrowDown}")
    const reopened = await within(document.body).findByRole("listbox")
    await waitFor(() =>
      expect(reopened.contains(document.activeElement)).toBe(true),
    )
    await userEvent.keyboard("ana{Enter}")
    await waitFor(() =>
      expect(within(document.body).queryByRole("listbox")).toBeNull(),
    )
    await expect(trigger).toHaveTextContent("Anatomie")
  },
}

const manyCourses = Array.from({ length: 30 }, (_, index) => ({
  value: String(index + 1),
  label: `Kurs ${index + 1}`,
}))

export const LongList: Story = {
  render: () => (
    <Select items={manyCourses} defaultValue="1">
      <SelectTrigger aria-label="Kurs" className="w-62">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-48">
        <SelectGroup>
          {manyCourses.map((course) => (
            <SelectItem key={course.value} value={course.value}>
              {course.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement }) => {
    const { trigger, list, options } = await openSelect(canvasElement)
    const popup = list.closest("[data-slot=select-content]")
    if (!popup) throw new Error("Missing popup")
    await expect(popup.getBoundingClientRect().height).toBeLessThanOrEqual(192)
    await userEvent.keyboard("{End}")
    const last = options.getByRole("option", { name: "Kurs 30" })
    await waitFor(() => {
      expect(last).toHaveAttribute("data-highlighted")
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        popup.getBoundingClientRect().bottom,
      )
    })
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(within(document.body).queryByRole("listbox")).toBeNull(),
    )
    await expect(trigger).toHaveTextContent("Kurs 30")
  },
}

export const RegistryPositioning: Story = {
  render: () => (
    <Select items={courses} defaultValue="biochemistry">
      <SelectTrigger aria-label="Kurs" className="w-62">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {courses.map((course) => (
            <SelectItem key={course.value} value={course.value}>
              {course.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement }) => {
    const { list } = await openSelect(canvasElement)
    await expect(list.closest("[data-slot=select-content]")).toHaveAttribute(
      "data-align-trigger",
      "true",
    )
  },
}

export const Dark: Story = {
  ...Selected,
  globals: { theme: "dark" },
}
