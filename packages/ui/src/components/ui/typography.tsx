"use client"

import { Collapsible } from "@base-ui/react/collapsible"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import type * as React from "react"
import { useId } from "react"
import { cn } from "../../lib/utils.js"
import { Checkbox } from "./checkbox.js"

// Spec: docs/notion-spec/components/typography.md
// Notion spaces blocks with padding, never margins, so each block carries its
// own rhythm and a plain stack of them reproduces a Notion page. Block padding
// and the editable leaf's 2px padding are folded into one element (6 + 2 = 8).
// Text never animates.

type TextProps<T extends keyof React.JSX.IntrinsicElements> =
  useRender.ComponentProps<T> & React.ComponentProps<T>

// Every text block takes `render` to swap its element, e.g. an H1 rendered as
// `h2` under a page Title, the way Notion renders its headings.
function useTextBlock<T extends keyof React.JSX.IntrinsicElements>(
  tag: T,
  slot: string,
  classes: string,
  { className, render, ...props }: TextProps<T>,
) {
  return useRender({
    defaultTagName: tag,
    render,
    props: mergeProps<T>(
      { "data-slot": slot, className: cn(classes, className) } as never,
      props as never,
    ),
  })
}

const text = "text-primary break-words whitespace-break-spaces"

// Page title: 40/48 bold, inset 8px like the blocks below it
function Title(props: TextProps<"h1">) {
  return useTextBlock(
    "h1",
    "title",
    `${text} px-2 text-[40px] leading-[1.2] font-bold`,
    props,
  )
}

// Headings share a 1.3 ratio and weight 600; the space above shrinks per level
function H1(props: TextProps<"h1">) {
  return useTextBlock(
    "h1",
    "h1",
    `${text} px-2 pt-8 pb-2 text-[30px] leading-[1.3] font-semibold`,
    props,
  )
}
function H2(props: TextProps<"h2">) {
  return useTextBlock(
    "h2",
    "h2",
    `${text} px-2 pt-7 pb-2 text-2xl leading-[1.3] font-semibold`,
    props,
  )
}
function H3(props: TextProps<"h3">) {
  return useTextBlock(
    "h3",
    "h3",
    `${text} px-2 pt-6 pb-2 text-xl leading-[1.3] font-semibold`,
    props,
  )
}
function H4(props: TextProps<"h4">) {
  return useTextBlock(
    "h4",
    "h4",
    `${text} px-2 pt-5 pb-2 text-lg leading-[1.3] font-semibold`,
    props,
  )
}

// A one-line paragraph is a 40px block
function P(props: TextProps<"p">) {
  return useTextBlock("p", "p", `${text} p-2 text-base`, props)
}

// 3px rule in the text color, text 25px from the rule's outer edge. The 8px
// block padding sits on a wrapper so consecutive quotes keep their spacing.
function Blockquote({
  className,
  ...props
}: React.ComponentProps<"blockquote">) {
  return (
    <div data-slot="blockquote" className="p-2">
      <blockquote
        className={cn(
          text,
          "border-s-[3px] border-current px-5.5 text-base",
          className,
        )}
        {...props}
      />
    </div>
  )
}

// Rows are 35/30/35px: the list adds 5px above and below its 30px rows.
// Render an `ol` for numbers.
function List(props: TextProps<"ul">) {
  return useTextBlock(
    "ul",
    "list",
    "px-1.5 py-[5px] [counter-reset:nui-list]",
    props,
  )
}

// Marker in a 24px slot 2px in, text 6px after it. Bullets are Arial 24px,
// numbers 16px in the body font.
function ListItem(props: TextProps<"li">) {
  return useTextBlock(
    "li",
    "list-item",
    `${text} relative py-[3px] ps-8 text-base [counter-increment:nui-list] before:absolute before:start-0.5 before:w-6 before:text-center before:font-[Arial] before:text-2xl before:leading-6 before:content-['•'] in-[ol]:before:font-sans in-[ol]:before:text-base in-[ol]:before:content-[counter(nui-list)'.']`,
    props,
  )
}

// A list row with a checkbox in the marker slot (centred in 24×28). The text
// names the checkbox; once checked it is struck through at half-alpha and
// faded to 70%.
function TodoItem({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"li">, "defaultChecked"> &
  Pick<
    React.ComponentProps<typeof Checkbox>,
    "checked" | "defaultChecked" | "onCheckedChange" | "disabled"
  >) {
  const id = useId()
  return (
    <li
      data-slot="todo-item"
      className={cn("group/todo flex py-px ps-0.5", className)}
      {...props}
    >
      <span className="flex h-7 w-6 shrink-0 items-center justify-center">
        <Checkbox
          aria-labelledby={id}
          checked={checked}
          defaultChecked={defaultChecked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        />
      </span>
      <span
        id={id}
        data-slot="todo-text"
        className={cn(
          text,
          "min-w-0 flex-1 py-0.5 ps-1.5 text-base group-has-[[data-checked]]/todo:line-through group-has-[[data-checked]]/todo:decoration-[rgb(from_var(--n-texPri)_r_g_b/0.5)] group-has-[[data-checked]]/todo:opacity-70",
        )}
      >
        {children}
      </span>
    </li>
  )
}

// Notion's weight for bold marks is 600, not the browser's 700
function Strong(props: TextProps<"strong">) {
  return useTextBlock("strong", "strong", "font-semibold", props)
}

function Underline(props: TextProps<"u">) {
  return useTextBlock(
    "u",
    "underline",
    "underline decoration-[0.05em] underline-offset-[10%]",
    props,
  )
}

function InlineCode(props: TextProps<"code">) {
  return useTextBlock(
    "code",
    "inline-code",
    "bg-interactive-translucent text-red-secondary relative bottom-[0.065em] rounded-sm px-[0.4em] py-[0.2em] font-mono text-[85%] leading-normal break-words",
    props,
  )
}

// Same color as the text at 70% opacity, with a thin translucent underline
function Link(props: TextProps<"a">) {
  return useTextBlock(
    "a",
    "link",
    "cursor-pointer break-words text-inherit underline decoration-(color:--n-opaLinDecCol) decoration-[0.05em] underline-offset-[10%] opacity-70",
    props,
  )
}

// Gray surface, 10px radius, a 24px icon slot centred on the first line
function Callout({
  icon,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { icon?: React.ReactNode }) {
  return (
    <div data-slot="callout" className={cn("p-2", className)} {...props}>
      <div className="bg-gray-primary flex rounded-[10px] border border-transparent p-3">
        {icon && (
          <span
            data-slot="callout-icon"
            className="flex h-10 w-6 shrink-0 items-center justify-center text-[21.6px] leading-none"
          >
            {icon}
          </span>
        )}
        <div className={cn(text, "min-w-0 flex-1 p-2 text-base")}>
          {children}
        </div>
      </div>
    </div>
  )
}

// Prism's light and dark palettes, as Notion ships them (untokenized)
const prism = [
  "[&_.token.comment]:text-[#708090] [&_.token.prolog]:text-[#708090] [&_.token.doctype]:text-[#708090] [&_.token.cdata]:text-[#708090]",
  "[&_.token.punctuation]:text-[#999999]",
  "[&_.token.property]:text-[#990055] [&_.token.tag]:text-[#990055] [&_.token.boolean]:text-[#990055] [&_.token.number]:text-[#990055] [&_.token.constant]:text-[#990055] [&_.token.symbol]:text-[#990055]",
  "[&_.token.selector]:text-[#669900] [&_.token.attr-name]:text-[#669900] [&_.token.string]:text-[#669900] [&_.token.char]:text-[#669900] [&_.token.builtin]:text-[#669900]",
  "[&_.token.operator]:text-[#9a6e3a] [&_.token.entity]:text-[#9a6e3a] [&_.token.url]:text-[#9a6e3a]",
  "[&_.token.atrule]:text-[#0077aa] [&_.token.attr-value]:text-[#0077aa] [&_.token.keyword]:text-[#0077aa]",
  "[&_.token.function]:text-[#dd4a68] [&_.token.class-name]:text-[#dd4a68]",
  "[&_.token.regex]:text-[#ee9900] [&_.token.important]:text-[#ee9900] [&_.token.variable]:text-[#ee9900]",
  "dark:[&_.token.comment]:text-[#998066] dark:[&_.token.prolog]:text-[#998066] dark:[&_.token.doctype]:text-[#998066] dark:[&_.token.cdata]:text-[#998066]",
  "dark:[&_.token.punctuation]:text-primary",
  "dark:[&_.token.property]:text-[#d1949e] dark:[&_.token.tag]:text-[#d1949e] dark:[&_.token.boolean]:text-[#d1949e] dark:[&_.token.number]:text-[#d1949e] dark:[&_.token.constant]:text-[#d1949e] dark:[&_.token.symbol]:text-[#d1949e]",
  "dark:[&_.token.selector]:text-[#bde052] dark:[&_.token.attr-name]:text-[#bde052] dark:[&_.token.string]:text-[#bde052] dark:[&_.token.char]:text-[#bde052] dark:[&_.token.builtin]:text-[#bde052]",
  "dark:[&_.token.operator]:text-[#f5b83d] dark:[&_.token.entity]:text-[#f5b83d] dark:[&_.token.url]:text-[#f5b83d]",
  "dark:[&_.token.atrule]:text-[#66a2cc] dark:[&_.token.attr-value]:text-[#66a2cc] dark:[&_.token.keyword]:text-[#66a2cc]",
  "dark:[&_.token.function]:text-[#ecec93] dark:[&_.token.class-name]:text-[#ecec93]",
  "dark:[&_.token.deleted]:text-[red]",
].join(" ")

// Monospace 13.6/20.4 on a translucent gray surface. Highlighted markup using
// Prism's `.token` classes picks up Notion's syntax colors.
function CodeBlock({
  className,
  children,
  ...props
}: React.ComponentProps<"pre">) {
  return (
    <div data-slot="code-block" className="p-2">
      <pre
        className={cn(
          "bg-gray-primary-translucent text-primary overflow-x-auto rounded-[10px] px-5.5 py-9 font-mono text-[13.6px] leading-normal whitespace-pre [tab-size:2]",
          prism,
          className,
        )}
        {...props}
      >
        <code>{children}</code>
      </pre>
    </div>
  )
}

// Notion's toggle block on Base UI's Collapsible. The trigger is the whole
// summary row so its text names the button; only the 24px arrow square fills
// on hover.
function ToggleBlock({ className, ...props }: Collapsible.Root.Props) {
  return (
    <Collapsible.Root
      data-slot="toggle-block"
      className={cn("text-primary", className)}
      {...props}
    />
  )
}

function ToggleBlockTrigger({
  className,
  children,
  ...props
}: Collapsible.Trigger.Props) {
  return (
    <Collapsible.Trigger
      data-slot="toggle-block-trigger"
      className={cn(
        "group flex w-full cursor-pointer items-start p-1.5 text-left text-base outline-hidden",
        className,
      )}
      {...props}
    >
      <span className="group-hover:bg-interactive-translucent group-focus-visible:bg-interactive-translucent group-active:bg-interactive-translucent-200 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm transition-[background] duration-[20ms] ease-in">
        <svg
          viewBox="0 0 100 100"
          aria-hidden="true"
          className="size-[0.8em] fill-current transition-transform duration-200 ease-out group-data-panel-open:rotate-90"
        >
          <polygon points="20,10 85,50 20,90" />
        </svg>
      </span>
      <span className={cn(text, "min-w-0 flex-1 py-0.5 ps-1.5")}>
        {children}
      </span>
    </Collapsible.Trigger>
  )
}

// Children line up with nested list blocks, 32px in
function ToggleBlockPanel({ className, ...props }: Collapsible.Panel.Props) {
  return (
    <Collapsible.Panel
      data-slot="toggle-block-panel"
      className={cn("ps-8", className)}
      {...props}
    />
  )
}

export {
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
}
