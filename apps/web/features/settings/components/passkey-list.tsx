import { Button } from "@nunio/ui/components/button/button";
import { KeyRound } from "lucide-react";
import type { SecurityPasskey } from "../api/passkey-queries";

const day = (value: string | Date) =>
  new Date(value).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function PasskeyList({
  passkeys,
  onDelete,
  deleting,
}: {
  passkeys: SecurityPasskey[];
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  if (passkeys.length === 0)
    return (
      <p className="text-sm leading-5 text-base-500">
        Du hast noch keinen Passkey. Mit einem Passkey meldest du dich per Face
        ID, Fingerabdruck oder Geräte-PIN an, ohne auf einen Code zu warten.
      </p>
    );
  return (
    <ul className="flex flex-col gap-6">
      {passkeys.map((passkey) => {
        const name = passkey.name || "Passkey";
        return (
          <li
            key={passkey.id}
            className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3"
          >
            <KeyRound
              aria-hidden="true"
              className="size-5 shrink-0 text-base-500"
            />
            <div className="min-w-0">
              <p className="truncate text-sm leading-4.5 font-medium text-base-800">
                {name}
              </p>
              <p className="mt-0.5 text-xs leading-4 text-base-500">
                Hinzugefügt am {day(passkey.createdAt)} ·{" "}
                {passkey.lastUsedAt
                  ? `Zuletzt verwendet am ${day(passkey.lastUsedAt)}`
                  : "Noch nie verwendet"}
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={deleting}
              aria-label={`${name} löschen`}
              onClick={() => onDelete(passkey.id)}
            >
              Löschen
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
