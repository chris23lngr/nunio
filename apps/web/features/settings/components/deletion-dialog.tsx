import { Button } from "@nunio/ui/components/button/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nunio/ui/components/dialog/dialog";
import type { ReactNode } from "react";
import { useState } from "react";

export function DeletionDialog({
  onSubmit,
  onReset,
  pending,
  signInAgain,
  error,
}: {
  onSubmit: () => void;
  onReset: () => void;
  pending: boolean;
  /** Shown instead of the submit button when the session is too old; it sends the request again. */
  signInAgain?: ReactNode;
  error?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) onReset();
      }}
    >
      <DialogTrigger render={<Button variant="destructive" />}>
        Konto löschen
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Konto löschen?</DialogTitle>
          <DialogDescription>
            Dein Konto wird zur manuellen Löschung vorgemerkt. Du wirst sofort
            auf allen Geräten abgemeldet und kannst dich danach nicht mehr
            anmelden.
          </DialogDescription>
        </DialogHeader>
        {(signInAgain || error) && (
          <DialogBody>
            {signInAgain ??
              (error && (
                <p role="alert" className="text-sm text-destructive-700">
                  {error}
                </p>
              ))}
          </DialogBody>
        )}
        <DialogFooter>
          {!signInAgain && (
            <Button
              variant="destructive"
              disabled={pending}
              aria-busy={pending}
              onClick={() => {
                if (!pending) onSubmit();
              }}
            >
              Löschung anfordern
            </Button>
          )}
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Abbrechen
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
