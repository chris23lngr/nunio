import { Button } from "@nunio/ui/components/button/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@nunio/ui/components/dialog";
import { Field, FieldLabel } from "@nunio/ui/components/field/field";
import { Input } from "@nunio/ui/components/input/input";
import { useId, useState } from "react";
import { useAppForm } from "@/lib/form";

export function DeletionDialog({
  onSubmit,
  onReset,
  pending,
  error,
}: {
  onSubmit: (password: string) => Promise<void>;
  onReset: () => void;
  pending: boolean;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const passwordId = useId();
  const form = useAppForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(value.password);
      } catch {
        // The mutation's feedback is displayed below the password field.
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) {
          form.reset();
          onReset();
        }
      }}
    >
      <DialogTrigger render={<Button variant="destructive" />}>
        Konto löschen
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="w-md max-w-[calc(100vw-2rem)] overflow-y-auto bg-white p-6 text-base-800 shadow-lg outline-1 outline-base-700/15"
      >
        <DialogTitle className="text-lg leading-7 font-semibold">
          Konto löschen?
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-5 text-base-600">
          Dein Konto wird zur manuellen Löschung vorgemerkt. Du wirst sofort auf
          allen Geräten abgemeldet und kannst dich danach nicht mehr anmelden.
        </DialogDescription>
        <form
          className="mt-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) void form.handleSubmit();
          }}
        >
          <form.Field name="password">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={passwordId}>Passwort</FieldLabel>
                <Input
                  id={passwordId}
                  name={field.name}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={!!error || undefined}
                  aria-describedby={error ? `${passwordId}-error` : undefined}
                />
              </Field>
            )}
          </form.Field>
          {error && (
            <p
              id={`${passwordId}-error`}
              role="alert"
              className="mt-3 text-sm text-destructive-700"
            >
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <DialogClose
              render={<Button variant="outline" disabled={pending} />}
            >
              Abbrechen
            </DialogClose>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
            >
              {([canSubmit, submitting]) => (
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={!canSubmit || submitting || pending}
                  aria-busy={pending}
                >
                  Löschung anfordern
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
