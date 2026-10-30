import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import {
  Blockquote,
  Callout,
  CodeBlock,
  H1,
  H2,
  H3,
  H4,
  InlineCode,
  Link,
  List,
  ListItem,
  P,
  Strong,
  Title,
  TodoItem,
  ToggleBlock,
  ToggleBlockPanel,
  ToggleBlockTrigger,
  Underline,
} from "./typography.js"

const meta = {
  title: "Components/Typography",
  component: P,
  parameters: { layout: "padded" },
} satisfies Meta<typeof P>
export default meta

type Story = StoryObj<typeof meta>

const style = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo)
const box = (el: Element) => el.getBoundingClientRect()

// The sandbox page from the spec, in a 720px column like Notion's
function Page() {
  return (
    <article className="w-[720px]">
      <Title data-testid="title">nui sandbox typography</Title>
      <H1 render={(props) => <h2 {...props} />} data-testid="h1">
        H1
      </H1>
      <H2 render={(props) => <h3 {...props} />} data-testid="h2">
        H2
      </H2>
      <H3 render={(props) => <h4 {...props} />} data-testid="h3">
        H3
      </H3>
      <H4 render={(props) => <h5 {...props} />} data-testid="h4">
        H4
      </H4>
      <P data-testid="p">
        Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo
        ligula eget dolor. <Strong data-testid="strong">Bold</Strong>,{" "}
        <em>italic</em>, <Underline>underline</Underline>, <s>strike</s>,{" "}
        <InlineCode data-testid="code">inline code</InlineCode> and{" "}
        <Link href="#typography" data-testid="link">
          a link
        </Link>
        .
      </P>
      <Blockquote data-testid="quote">
        Das ist ein Zitat
        {"\n"}und das ist die zweite Zeile
      </Blockquote>
      <Callout icon="💡" data-testid="callout">
        Das ist eine normale Hervorhebung
      </Callout>
      <CodeBlock data-testid="pre">
        <span className="token function">console</span>
        <span className="token punctuation">.</span>
        <span className="token function">log</span>
        <span className="token punctuation">(</span>
        <span className="token string">"Hello World"</span>
        <span className="token punctuation">);</span>
      </CodeBlock>
      <List data-testid="ul">
        <ListItem>One</ListItem>
        <ListItem>Two</ListItem>
        <ListItem>Three</ListItem>
      </List>
      <List render={<ol />} data-testid="ol">
        <ListItem>One</ListItem>
        <ListItem>Two</ListItem>
        <ListItem>Three</ListItem>
      </List>
      <List data-testid="todos">
        <TodoItem>ToDo 1</TodoItem>
        <TodoItem defaultChecked>ToDo 2</TodoItem>
        <TodoItem>ToDo 3</TodoItem>
      </List>
      <ToggleBlock>
        <ToggleBlockTrigger>
          <Strong>This is a toggle</Strong>
        </ToggleBlockTrigger>
        <ToggleBlockPanel>
          <P>Hidden content</P>
        </ToggleBlockPanel>
      </ToggleBlock>
    </article>
  )
}

export const Basic: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Headings keep the level passed through `render`
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent(
      "nui sandbox typography",
    )
    await expect(canvas.getByRole("heading", { level: 2 })).toHaveTextContent(
      "H1",
    )

    // Each to-do's text names its checkbox
    const todo = canvas.getByRole("checkbox", { name: "ToDo 1" })
    await userEvent.click(todo)
    await expect(todo).toHaveAttribute("aria-checked", "true")

    // The toggle's text names its trigger, which opens the panel
    const trigger = canvas.getByRole("button", { name: "This is a toggle" })
    await expect(canvas.queryByText("Hidden content")).toBeNull()
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(canvas.getByText("Hidden content")).toBeVisible()
  },
}

// Values from docs/notion-spec/components/typography.md
export const SpecStyling: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    const dark = document.documentElement.classList.contains("dark")
    const canvas = within(canvasElement)
    const get = (id: string) => canvas.getByTestId(id)
    const texPri = dark ? "rgb(240, 239, 237)" : "rgb(44, 44, 43)"

    // Size, line height, weight and block height (padding folds Notion's
    // wrapper and leaf: one-line blocks are as tall as Notion's)
    const scale = [
      ["title", "40px", "48px", "700", 48],
      ["h1", "30px", "39px", "600", 79],
      ["h2", "24px", "31.2px", "600", 67.2],
      ["h3", "20px", "26px", "600", 58],
      ["h4", "18px", "23.4px", "600", 51.4],
    ] as const
    for (const [id, size, leading, weight, height] of scale) {
      const el = get(id)
      await expect(style(el).fontSize).toBe(size)
      await expect(style(el).lineHeight).toBe(leading)
      await expect(style(el).fontWeight).toBe(weight)
      await expect(style(el).color).toBe(texPri)
      await expect(style(el).letterSpacing).toBe("normal")
      await expect(box(el).height).toBeCloseTo(height, 0)
    }

    // Paragraph: 16/24 in texPri, text inset 8px
    const p = get("p")
    await expect(style(p).fontSize).toBe("16px")
    await expect(style(p).lineHeight).toBe("24px")
    await expect(style(p).padding).toBe("8px")

    // Marks: bold is 600; inline code is 85% mono on bacIntTra in redTexSec
    await expect(style(get("strong")).fontWeight).toBe("600")
    const code = get("code")
    await expect(style(code).fontSize).toBe("13.6px")
    await expect(style(code).fontFamily).toMatch(/^"?SFMono-Regular/)
    await expect(style(code).borderRadius).toBe("4px")
    await expect(style(code).paddingLeft).toBe("5.44px")
    await expect(style(code).color).toBe("rgb(207, 81, 72)")

    // Link: inherits texPri at 70% with a 0.05em translucent underline
    const link = get("link")
    await expect(style(link).color).toBe(texPri)
    await expect(style(link).opacity).toBe("0.7")
    await expect(style(link).textDecorationLine).toBe("underline")
    await expect(style(link).cursor).toBe("pointer")

    // Quote: 3px rule in the text color, text 25px from its outer edge
    const quote = get("quote")
    await expect(style(quote).borderInlineStartWidth).toBe("3px")
    await expect(style(quote).borderInlineStartColor).toBe(texPri)
    await expect(style(quote).paddingInlineStart).toBe("22px")

    // Callout: 12px padding, 10px radius on graBacPri, 66px for one line
    const callout = get("callout").firstElementChild as Element
    await expect(style(callout).padding).toBe("12px")
    await expect(style(callout).borderRadius).toBe("10px")
    await expect(box(callout).height).toBe(66)

    // Code block: 13.6/20.4 mono, 10px radius, 92.4px for one line
    const pre = get("pre")
    await expect(style(pre).fontSize).toBe("13.6px")
    await expect(style(pre).lineHeight).toBe("20.4px")
    await expect(style(pre).whiteSpace).toBe("pre")
    await expect(box(pre).height).toBeCloseTo(92.4, 0)

    // Lists: 35/30/35px rows, Arial bullet and centred numbers in a 24px slot
    for (const id of ["ul", "ol"]) {
      const rows = [...get(id).children].map((li) => box(li).height)
      const list = get(id)
      await expect(rows).toEqual([30, 30, 30])
      await expect(box(list).height).toBe(100)
    }
    // To-dos: same 35/30/35 rhythm, box at +4,+6 in its slot, checked text
    // struck through and faded
    const todos = get("todos")
    await expect(box(todos).height).toBe(100)
    const row = todos.children[1] as Element
    const check = row.querySelector("[data-slot=checkbox]") as Element
    await expect(box(check).left - box(row).left).toBe(6)
    await expect(box(check).top - box(row).top).toBe(7)
    const done = row.querySelector("[data-slot=todo-text]") as Element
    await expect(style(done).textDecorationLine).toBe("line-through")
    await expect(style(done).opacity).toBe("0.7")

    const bullet = style(get("ul").children[0] as Element, "::before")
    await expect(bullet.content).toBe('"•"')
    await expect(bullet.fontSize).toBe("24px")
    const number = style(get("ol").children[1] as Element, "::before")
    await expect(number.content).toMatch(/counter/)
    await expect(number.fontSize).toBe("16px")
    await expect(number.textAlign).toBe("center")
  },
}

export const SpecStylingDark: Story = {
  ...SpecStyling,
  globals: { theme: "dark" },
}
