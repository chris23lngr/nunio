import { Button } from "@nunio/ui/components/button/button";
import { Laptop, Smartphone } from "lucide-react";
import type { SecuritySession } from "../api/session-queries";
import { sessionDevice } from "../session-device";

export function SessionList({
  sessions,
  currentToken,
  onSignOut,
  signingOut,
}: {
  sessions: SecuritySession[];
  currentToken: string | null;
  onSignOut: (token: string) => void;
  signingOut: boolean;
}) {
  return (
    <ul className="flex flex-col gap-6">
      {sessions.map((session) => {
        const device = sessionDevice(session.userAgent);
        const Icon = device.mobile ? Smartphone : Laptop;
        return (
          <li
            key={session.id}
            className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 @min-[30rem]:grid-cols-[20px_minmax(0,1fr)_auto]"
          >
            <Icon
              aria-hidden="true"
              className="size-5 shrink-0 text-base-500"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-4.5 font-medium text-base-800">
                {device.name}
              </p>
              <p className="mt-0.5 text-xs leading-4 text-base-500">
                {device.browser && `${device.browser} · `}
                Angemeldet am{" "}
                {new Date(session.createdAt).toLocaleString("de-DE", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div className="col-start-2 flex items-center justify-end gap-3 @min-[30rem]:col-start-auto @min-[30rem]:self-center">
              <span
                className={`w-22 shrink-0 items-center justify-end ${session.token === currentToken ? "flex" : "hidden @min-[30rem]:flex"}`}
              >
                {session.token === currentToken && (
                  <span className="rounded-[5px] bg-primary-100 px-1 py-0.5 text-xs leading-4 font-medium text-primary-600">
                    Dieses Gerät
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                disabled={signingOut}
                onClick={() => onSignOut(session.token)}
              >
                Abmelden
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
