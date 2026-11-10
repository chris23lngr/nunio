import type { PhrasingContent, Root } from "mdast"
import { visit } from "unist-util-visit"

export type MdxReference = { tag: string; label: string; href?: string }

export function referencePlugin(
  references: readonly MdxReference[],
  inline = false,
) {
  return () => (tree: Root) => {
    const used = new Map<string, MdxReference>()
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined || parent.type === "link") return
      const parts: PhrasingContent[] = []
      let end = 0
      for (const match of node.value.matchAll(/\[([^\]\n]+)\]/g)) {
        const reference = references.find(({ tag }) => tag === match[1])
        if (!reference) continue
        if (match.index > end)
          parts.push({
            type: "text",
            value: node.value.slice(end, match.index),
          })
        parts.push(
          inline
            ? {
                type: "link",
                url: `#citation-${reference.tag}`,
                children: [{ type: "text", value: `[${reference.tag}]` }],
              }
            : {
                type: "footnoteReference",
                identifier: `citation-${reference.tag.toLowerCase()}`,
              },
        )
        used.set(reference.tag, reference)
        end = match.index + match[0].length
      }
      if (!parts.length) return
      if (end < node.value.length)
        parts.push({ type: "text", value: node.value.slice(end) })
      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
    if (inline) return
    for (const reference of used.values()) {
      tree.children.push({
        type: "footnoteDefinition",
        identifier: `citation-${reference.tag.toLowerCase()}`,
        children: [
          {
            type: "paragraph",
            children: reference.href
              ? [
                  {
                    type: "link",
                    url: reference.href,
                    children: [{ type: "text", value: reference.label }],
                  },
                ]
              : [{ type: "text", value: reference.label }],
          },
        ],
      })
    }
  }
}
