import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Citation } from "../citation/citation.js"
import { MdxContent } from "./mdx.js"

const meta = {
  title: "Components/new/MDX",
  component: MdxContent,
  decorators: [
    (Story) => (
      <div className="w-[647px] max-w-full bg-white p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MdxContent>
export default meta
type Story = StoryObj<typeof meta>

export const Typography: Story = {
  args: {
    content:
      "Un système pour apprendre.\n\n## Die Grundlage\n\nEin **persönliches Lernsystem**.\n\n1. Wissen abrufen\n2. Wiederholen\n\n### Nächster Schritt\n\nSelbst erklären.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const h2 = canvas.getByRole("heading", { name: "Die Grundlage" })
    const paragraph = canvas.getByText("Un système pour apprendre.")
    await expect(getComputedStyle(paragraph).fontSize).toBe("15px")
    await expect(getComputedStyle(paragraph).lineHeight).toBe("26px")
    await expect(getComputedStyle(h2).fontSize).toBe("20px")
    await expect(getComputedStyle(h2).marginTop).toBe("32px")
    await expect(
      getComputedStyle(
        canvas.getByText("persönliches Lernsystem")
          .parentElement as HTMLElement,
      ).marginTop,
    ).toBe("12px")
    await expect(
      getComputedStyle(canvas.getByText("Wiederholen")).marginTop,
    ).toBe("8px")
    await expect(getComputedStyle(paragraph).marginTop).toBe("0px")
  },
}

export const RichAnswer: Story = {
  args: {
    content:
      "> [!TIP]\n> Schließe die Unterlagen.\n\n- [x] Abrufen\n- [ ] Üben\n\n| Methode | Minuten |\n| --- | ---: |\n| Abrufen | 15 |\n\n```python\nprint(3)\n```\n\nDer Mittelwert ist $\\mu$.\n\n$$\n\\frac{1}{n} \\sum_{i=1}^n x_i\n$$",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Probier es aus")).toBeVisible()
    await expect(canvas.getByRole("table")).toBeVisible()
    await expect(canvas.getAllByRole("checkbox")).toHaveLength(2)
    await expect(
      canvas.getByRole("checkbox", { name: "Abrufen" }),
    ).toBeDisabled()
    await expect(
      getComputedStyle(canvas.getByText("print(3)")).fontFamily,
    ).toContain("IBM Plex Mono")
    await expect(canvasElement.querySelector(".katex")).not.toBeNull()
    await userEvent.click(canvas.getByRole("button", { name: "Code kopieren" }))
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        /Kopiert|Kopieren nicht möglich/,
      ),
    )
  },
}

export const References: Story = {
  args: { content: "Eine Antwort [S1]. Code `[S1]`." },
  render: (args) => (
    <>
      <MdxContent
        {...args}
        references={[
          {
            tag: "S1",
            label: "Modulhandbuch, Seite 2",
            href: "/sources/source-1?page=2",
          },
        ]}
      />
      <MdxContent
        {...args}
        references={[{ tag: "S1", label: "Quelle gelöscht" }]}
      />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const source = canvas.getByRole("link", { name: "Modulhandbuch, Seite 2" })
    await expect(source).toHaveAttribute("target", "_blank")
    await expect(canvas.getByText("Quelle gelöscht")).toBeVisible()
    const refs = canvas.getAllByRole("link", { name: "1" })
    await expect(refs).toHaveLength(2)
    await expect(refs[0]?.getAttribute("href")).not.toBe(
      refs[1]?.getAttribute("href"),
    )
    await expect(
      canvas.getAllByText("[S1]", { selector: "code" }),
    ).toHaveLength(2)
  },
}

export const Composition: Story = {
  args: {
    content:
      "## Ein Abschnitt\n\n### Direkt folgende Überschrift\n\nEin Absatz.\n\nNoch ein Absatz.\n\n> Ein Zitat.\n>\n> Mit zweitem Absatz.\n\n---\n\nEin Ende.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      getComputedStyle(
        canvas.getByRole("heading", { name: "Direkt folgende Überschrift" }),
      ).marginTop,
    ).toBe("12px")
    await expect(
      getComputedStyle(canvas.getByText("Noch ein Absatz.")).marginTop,
    ).toBe("24px")
    await expect(
      getComputedStyle(canvas.getByText("Mit zweitem Absatz.")).marginTop,
    ).toBe("12px")
  },
}

export const Image: Story = {
  args: {
    content:
      '![Lernzyklus](https://example.invalid/diagram.png "Drei Schritte")',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const caption = canvas.getByText("Drei Schritte")
    await expect(getComputedStyle(caption).marginTop).toBe("8px")
    await expect(getComputedStyle(caption).fontSize).toBe("14px")
    canvas
      .getByRole("img", { name: "Lernzyklus" })
      .dispatchEvent(new Event("error"))
    await waitFor(() => expect(canvas.getByText("Lernzyklus")).toBeVisible())
  },
}

export const CitationPreviews: Story = {
  args: {
    content: "Eine Antwort [S1]. Unbekannt [S9]. Code `[S1]`.",
    references: [
      { tag: "S1", label: "Skript, Seite 2", href: "/sources/skript?page=2" },
    ],
    renderReference: (reference) => (
      <Citation
        tag={reference.tag}
        title={reference.label}
        href={reference.href}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(
      canvas.getByRole("button", { name: "Quelle S1: Skript, Seite 2" }),
    )
    const page = within(canvasElement.ownerDocument.body)
    await expect(
      await page.findByRole("link", { name: "Quelle öffnen" }),
    ).toHaveAttribute("href", "/sources/skript?page=2")
    await expect(canvas.getByText("[S1]", { selector: "code" })).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: /Quelle S9/ }),
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole("heading", { name: "Quellen und Fußnoten" }),
    ).not.toBeInTheDocument()
  },
}
