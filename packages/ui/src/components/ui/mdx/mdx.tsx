"use client"

import { cn } from "cn"
import type { Root } from "mdast"
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { memo, useId, useMemo, useState } from "react"
import type { Components } from "react-markdown"
import Markdown from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { visit } from "unist-util-visit"
import type { MdxReference } from "./references.js"
import { referencePlugin } from "./references.js"

export type { MdxReference } from "./references.js"

const noReferences: readonly MdxReference[] = []

function callouts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (node) => {
      const first = node.children[0]
      const text = first?.type === "paragraph" ? first.children[0] : undefined
      if (text?.type !== "text") return
      const match = text.value.match(/^\[!(NOTE|TIP|WARNING)\]\s*/)
      if (!match) return
      const kind = match[1] as "NOTE" | "TIP" | "WARNING"
      text.value = text.value.slice(match[0].length)
      node.data = {
        ...node.data,
        hName: "aside",
        hProperties: { "data-callout": kind.toLowerCase() },
      }
      node.children.unshift({
        type: "paragraph",
        children: [
          {
            type: "strong",
            children: [
              {
                type: "text",
                value:
                  kind === "TIP"
                    ? "Probier es aus"
                    : kind === "WARNING"
                      ? "Achte auf den Unterschied"
                      : "Merke",
              },
            ],
          },
        ],
      })
    })
  }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState("")
  const code = children as ReactElement<{
    children?: string
    className?: string
  }>
  const language = code.props.className?.replace("language-", "") ?? "Code"
  return (
    <div className="mdx-code">
      <div className="mdx-code-toolbar">
        <span>{language}</span>
        <button
          type="button"
          aria-label="Code kopieren"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                String(code.props.children ?? "").replace(/\n$/, ""),
              )
              setStatus("Kopiert")
            } catch {
              setStatus("Kopieren nicht möglich")
            }
          }}
        >
          Kopieren
        </button>
        <span role="status">{status}</span>
      </div>
      <pre>{children}</pre>
    </div>
  )
}

function MdxImage({ alt, ...props }: ComponentProps<"img">) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <span role="img" aria-label={alt || "Bild nicht verfügbar"}>
      {alt || "Bild nicht verfügbar"}
    </span>
  ) : (
    <img
      {...props}
      alt={alt ?? ""}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

// Stable across renders, so streaming updates don't remount these elements.
const staticComponents: Components = {
  pre: CodeBlock,
  p: ({ node, children }) => {
    const image = node?.children[0]
    return node?.children.length === 1 &&
      image?.type === "element" &&
      image.tagName === "img" ? (
      <figure>
        {children}
        {image.properties.title && (
          <figcaption>{String(image.properties.title)}</figcaption>
        )}
      </figure>
    ) : (
      <p>{children}</p>
    )
  },
  li: ({ node: _node, children, className, ...props }) => (
    <li {...props} className={className}>
      {className?.includes("task-list-item") ? (
        // biome-ignore lint/a11y/noLabelWithoutControl: GFM children include the native disabled checkbox.
        <label>{children}</label>
      ) : (
        children
      )}
    </li>
  ),
  table: ({ children }) => (
    <section
      className="mdx-table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll a wide table.
      tabIndex={0}
      aria-label="Tabelle horizontal scrollen"
    >
      <table>{children}</table>
    </section>
  ),
  img: ({ node: _node, ...props }) => <MdxImage {...props} />,
}
const rehypePlugins = [rehypeKatex]

export const MdxContent = memo(function MdxContent({
  content,
  className,
  references = noReferences,
  renderReference,
}: {
  content: string
  className?: string
  references?: readonly MdxReference[]
  renderReference?: (reference: MdxReference) => ReactNode
}) {
  const id = useId()
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkMath,
      callouts,
      referencePlugin(references, !!renderReference),
    ],
    [references, renderReference],
  )
  const components = useMemo<Components>(
    () => ({
      ...staticComponents,
      a: ({ node: _node, href, children, ...props }) => {
        const reference = href?.startsWith("#citation-")
          ? references.find(({ tag }) => href === `#citation-${tag}`)
          : undefined
        if (reference && renderReference)
          return <>{renderReference(reference)}</>
        return (
          <a
            {...props}
            href={href}
            {...(href?.startsWith("#")
              ? {}
              : { target: "_blank", rel: "noreferrer" })}
          >
            {children}
          </a>
        )
      },
    }),
    [references, renderReference],
  )
  return (
    <div className={cn("nunio-mdx", className)}>
      <Markdown
        skipHtml
        remarkRehypeOptions={{
          clobberPrefix: `mdx-${id}-`,
          footnoteLabel: "Quellen und Fußnoten",
        }}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  )
})
