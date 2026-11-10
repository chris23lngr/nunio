"use client"

import { cn } from "cn"
import type { Root } from "mdast"
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { useId, useState } from "react"
import Markdown from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { visit } from "unist-util-visit"
import type { MdxReference } from "./references.js"
import { referencePlugin } from "./references.js"

export type { MdxReference } from "./references.js"

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

export function MdxContent({
  content,
  className,
  references = [],
}: {
  content: string
  className?: string
  references?: readonly MdxReference[]
}) {
  const id = useId()
  return (
    <div className={cn("nunio-mdx", className)}>
      <Markdown
        skipHtml
        remarkRehypeOptions={{
          clobberPrefix: `mdx-${id}-`,
          footnoteLabel: "Quellen und Fußnoten",
        }}
        remarkPlugins={[
          remarkGfm,
          remarkMath,
          callouts,
          referencePlugin(references),
        ]}
        rehypePlugins={[rehypeKatex]}
        components={{
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
          a: ({ node: _node, href, children, ...props }) => (
            <a
              {...props}
              href={href}
              {...(href?.startsWith("#")
                ? {}
                : { target: "_blank", rel: "noreferrer" })}
            >
              {children}
            </a>
          ),
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
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
