"use client";

import { Button } from "@nunio/ui/components/button/button";
import { Checkbox } from "@nunio/ui/components/checkbox/checkbox";
import { useEffect, useId, useState } from "react";
import type { OutreachSettings } from "@/features/inbox/api/settings-queries";
import { useBrowserPush } from "@/features/inbox/use-browser-push";
import { useOutreachSettings } from "@/features/inbox/use-outreach-settings";
import { SettingGroup } from "./setting-group";

export function NotificationChannels({
  apiOrigin,
  settings,
  onDirtyChange,
}: {
  apiOrigin: string;
  settings: OutreachSettings;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const id = useId();
  const { update } = useOutreachSettings(apiOrigin);
  const push = useBrowserPush(apiOrigin);
  const [pushDraft, setPushDraft] = useState<boolean | null>(null);
  const pushEnabled = pushDraft ?? push.state === "on";
  const pushDirty = pushDraft !== null && pushDraft !== (push.state === "on");
  const pending = update.isPending || push.busy;
  const [emailDraft, setEmailDraft] = useState<boolean | null>(null);
  const email = emailDraft ?? settings.email;
  const emailDirty = email !== settings.email;
  const dirty = pushDirty || emailDirty;
  useEffect(() => {
    onDirtyChange(dirty || pending);
  }, [dirty, pending, onDirtyChange]);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (pushDirty) {
          if (!(await (pushEnabled ? push.turnOn() : push.turnOff()))) return;
          setPushDraft(null);
        }
        if (!emailDirty) return;
        update.mutate(
          { email },
          {
            onSuccess: () => {
              setEmailDraft(null);
            },
          },
        );
      }}
    >
      <SettingGroup
        title="Benachrichtigungen"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || pending}
              onClick={() => {
                setEmailDraft(null);
                setPushDraft(null);
                update.reset();
              }}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!dirty || pending}
            >
              Speichern
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-2">
          <div className="text-sm leading-5">
            <h3 className="font-medium">Benachrichtigungen</h3>
            <p className="mt-1 text-base-500">
              Verwalte, auf welchen Wegen du Benachrichtigungen erhalten
              möchtest.
            </p>
          </div>
          <fieldset
            disabled={pending}
            className="flex min-w-0 flex-col gap-4 text-sm leading-5"
          >
            <label htmlFor={`${id}-email`} className="flex items-center gap-3">
              <Checkbox
                id={`${id}-email`}
                checked={email}
                onCheckedChange={setEmailDraft}
              />
              E-Mail
            </label>
            <label
              htmlFor={`${id}-push`}
              className="flex items-center gap-3 has-disabled:opacity-50"
            >
              <Checkbox
                id={`${id}-push`}
                checked={pushEnabled}
                disabled={
                  push.state === "checking" ||
                  push.state === "unsupported" ||
                  push.state === "blocked"
                }
                onCheckedChange={setPushDraft}
              />
              Browser-Push-Benachrichtigungen
            </label>
            {push.state === "unsupported" && (
              <p className="text-base-500">
                Dieser Browser unterstützt keine Push-Benachrichtigungen. Auf
                iPhone oder iPad füge nunio zuerst zum Home-Bildschirm hinzu.
                Dein Posteingang zeigt weiterhin alles.
              </p>
            )}
            {push.state === "blocked" && (
              <p role="alert" className="text-base-500">
                Benachrichtigungen sind in diesem Browser blockiert. Erlaube sie
                in den Website-Einstellungen deines Browsers.
              </p>
            )}
            <p className="text-base-500">
              E-Mails enthalten nur einen Hinweis auf deinen Posteingang.
            </p>
          </fieldset>
        </div>
        {push.error && (
          <p role="alert" className="mt-4 text-sm text-destructive-700">
            {push.error}
          </p>
        )}
        {update.error && (
          <p role="alert" className="mt-4 text-sm text-destructive-700">
            Die Einstellungen konnten nicht gespeichert werden. Bitte versuche
            es erneut.
          </p>
        )}
      </SettingGroup>
    </form>
  );
}
