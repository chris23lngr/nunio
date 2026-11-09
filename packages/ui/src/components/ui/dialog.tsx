"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import * as React from "react"
import { useOpenState } from "../../lib/use-open-state.js"
import { cn } from "../../lib/utils.js"
import { Button } from "./button.js"

// Spec: docs/notion-spec/components/dialog.md

const OpenContext = React.createContext(false)

function Dialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: DialogPrimitive.Root.Props) {
  const [open, handleOpenChange] = useOpenState({
    open: openProp,
    defaultOpen,
    onOpenChange,
  })
  return (
    <OpenContext value={open}>
      <DialogPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </OpenContext>
  )
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

// CSS `ease`. Notion fades backdrop and popup together and scales the popup
// up from 0.97.
const TRANSITION = { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] } as const

type DialogContentProps = DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}

// The frame only: size is set per surface (Settings is 90vw × viewport height
// minus 100px) and content brings its own padding
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogContentProps) {
  const open = React.useContext(OpenContext)

  return (
    <AnimatePresence>
      {open && (
        <DialogPrimitive.Portal keepMounted>
          <DialogPrimitive.Backdrop
            data-slot="dialog-backdrop"
            className="bg-overlay fixed inset-0 z-50"
            render={
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={TRANSITION}
              />
            }
          />
          <DialogPrimitive.Viewport
            data-slot="dialog-viewport"
            className="fixed inset-0 z-50 flex items-center justify-center"
          >
            {/* A `render` in props replaces the motion.div and with it the
                enter and exit animations */}
            <DialogPrimitive.Popup
              data-slot="dialog-content"
              className={cn(
                "bg-elevated text-primary shadow-screen relative max-h-full max-w-[90vw] overflow-hidden rounded-xl outline-hidden",
                className,
              )}
              render={
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={TRANSITION}
                />
              }
              {...props}
            >
              {children}
              {showCloseButton && (
                <DialogPrimitive.Close
                  data-slot="dialog-close"
                  aria-label="Close"
                  render={
                    <Button
                      size="icon-xs"
                      className="absolute top-3 right-3 size-[22px] rounded-full"
                    />
                  }
                >
                  <X className="text-icon-secondary size-3.5" />
                </DialogPrimitive.Close>
              )}
            </DialogPrimitive.Popup>
          </DialogPrimitive.Viewport>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

// Notion styles headings as page content; these name and describe the dialog
// and are styled by the caller
function DialogTitle(props: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" {...props} />
}

function DialogDescription(props: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description data-slot="dialog-description" {...props} />
  )
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
}
