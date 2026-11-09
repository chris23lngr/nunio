import { Field as FieldPrimitive } from "@base-ui/react/field"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import { Checkbox } from "../checkbox/checkbox.js"
import { Input } from "../input/input.js"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "./field.js"

const meta = {
  title: "Components/new/Field",
  component: Field,
  decorators: [
    (Story) => (
      <div className="w-96 max-w-full p-2">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <Field {...args}>
      <FieldLabel htmlFor="name">Name</FieldLabel>
      <Input id="name" aria-describedby="name-description" />
      <FieldDescription id="name-description">
        Your name as it appears on your account.
      </FieldDescription>
      <FieldError />
    </Field>
  ),
} satisfies Meta<typeof Field>
export default meta

type Story = StoryObj<typeof meta>

function tokenColor(canvas: HTMLElement, token: string) {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  canvas.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole("textbox", { name: "Name" })
    await userEvent.click(canvas.getByText("Name"))
    await expect(input).toHaveFocus()
    await expect(input).toHaveAccessibleDescription(
      "Your name as it appears on your account.",
    )
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument()
    await expect(getComputedStyle(canvas.getByText("Name")).color).toBe(
      tokenColor(canvasElement, "--base-800"),
    )
  },
}

export const Invalid: Story = {
  render: () => (
    <Field data-invalid>
      <FieldLabel htmlFor="email">Email</FieldLabel>
      <Input
        id="email"
        type="email"
        aria-invalid
        aria-describedby="email-error"
      />
      <FieldError
        id="email-error"
        errors={[
          { message: "Enter a valid email address." },
          { message: "Enter a valid email address." },
          { message: "Use your work email." },
        ]}
      />
    </Field>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const error = canvas.getByRole("alert")
    await expect(within(error).getAllByRole("listitem")).toHaveLength(2)
    await expect(canvas.getByRole("textbox")).toHaveAttribute(
      "aria-invalid",
      "true",
    )
    const color = tokenColor(canvasElement, "--destructive-700")
    await expect(getComputedStyle(error).color).toBe(color)
    await expect(getComputedStyle(canvas.getByText("Email")).color).toBe(color)
  },
}

export const BaseUI: Story = {
  render: () => (
    <FieldPrimitive.Root invalid disabled render={<Field />}>
      <FieldLabel htmlFor="base-name">Name</FieldLabel>
      <Input id="base-name" />
      <FieldError errors={[{ message: "Required." }]} />
    </FieldPrimitive.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("textbox", { name: "Name" })).toBeDisabled()
    await expect(canvas.getByRole("alert")).toHaveTextContent("Required.")
  },
}

export const Group: Story = {
  render: () => (
    <FieldSet>
      <FieldLegend>Profile</FieldLegend>
      <FieldDescription>Manage your account preferences.</FieldDescription>
      <FieldGroup>
        <Field orientation="responsive">
          <FieldLabel htmlFor="display-name">Display name</FieldLabel>
          <Input id="display-name" />
        </Field>
        <FieldSeparator>Notifications</FieldSeparator>
        <Field orientation="horizontal">
          <Checkbox id="updates" />
          <FieldContent>
            <FieldLabel htmlFor="updates">Product updates</FieldLabel>
            <FieldDescription>
              Receive occasional news by email.
            </FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
}

export const ChoiceCard: Story = {
  render: () => (
    <FieldLabel>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>Product updates</FieldTitle>
          <FieldDescription>Receive occasional news by email.</FieldDescription>
        </FieldContent>
        <Checkbox />
      </Field>
    </FieldLabel>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = canvas.getByRole("checkbox")
    await userEvent.click(canvas.getByText("Product updates"))
    await expect(checkbox).toBeChecked()
  },
}
