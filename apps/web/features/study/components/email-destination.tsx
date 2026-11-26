import { Button } from "@nunio/ui/components/button/button";
import { Input } from "@nunio/ui/components/input/input";
import { useId, useState } from "react";

type Shown = { address: string; note: string };

/**
 * The email Destination the student confirms, for an Obligation or as a Course's default. A prefill nunio found
 * is only a suggestion until the student confirms it.
 */
export function EmailDestination({
  confirmed,
  prefill,
  pending,
  error,
  onConfirm,
  onClear,
}: {
  confirmed: Shown | null;
  prefill: Shown | null;
  pending: boolean;
  error: string | null;
  onConfirm: (address: string) => Promise<unknown>;
  /** Null when nothing of its own is confirmed, such as when the Course's default applies. */
  onClear: (() => void) | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const inputId = useId();
  const shown = confirmed ?? prefill;

  const confirm = (address: string) =>
    onConfirm(address).then(
      () => setEditing(null),
      () => undefined,
    );

  return (
    <fieldset
      aria-label="Abgabe per E-Mail"
      className="flex min-w-0 flex-col gap-1.5"
    >
      {editing !== null ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            confirm(editing.trim());
          }}
        >
          <label htmlFor={inputId} className="text-xs text-base-500">
            E-Mail-Adresse
          </label>
          <Input
            id={inputId}
            type="email"
            required
            autoComplete="off"
            value={editing}
            onChange={(event) => setEditing(event.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Bestätigen
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      ) : shown ? (
        <>
          <span className="text-sm font-medium text-base-800">
            {shown.address}
          </span>
          <span className="text-xs text-base-500">{shown.note}</span>
          <div className="flex gap-3">
            {!confirmed && (
              <ActionButton
                disabled={pending}
                onClick={() => confirm(shown.address)}
              >
                Bestätigen
              </ActionButton>
            )}
            <ActionButton onClick={() => setEditing(shown.address)}>
              Ändern
            </ActionButton>
            {confirmed && onClear && (
              <ActionButton disabled={pending} onClick={onClear}>
                Entfernen
              </ActionButton>
            )}
          </div>
        </>
      ) : (
        <div>
          <ActionButton onClick={() => setEditing("")}>
            E-Mail-Adresse eintragen
          </ActionButton>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function ActionButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer text-[13px] leading-4.5 font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
