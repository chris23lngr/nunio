import { Button } from "@nunio/ui/components/button/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nunio/ui/components/dialog/dialog";
import type { ReactNode } from "react";

/** Asks before a change the student should see the consequences of. */
export function ConfirmDialog({
  title,
  children,
  confirm,
  destructive = false,
  ready = true,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirm: string;
  destructive?: boolean;
  ready?: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription render={<div />}>{children}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="px-6 text-sm text-destructive-700">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Abbrechen
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            disabled={pending || !ready}
            onClick={onConfirm}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
