"use client";

import { Button } from "@nunio/ui/components/button/button";
import { Checkbox } from "@nunio/ui/components/checkbox/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@nunio/ui/components/input-group/input-group";
import { useEffect, useId, useState } from "react";
import type { OutreachSettings } from "@/features/inbox/api/settings-queries";
import { useBrowserPush } from "@/features/inbox/use-browser-push";
import { useOutreachSettings } from "@/features/inbox/use-outreach-settings";
import { asMinute, asTime } from "@/lib/time";
import { SettingGroup } from "./setting-group";

type Channels = {
  email: boolean;
  briefingEmail: boolean;
  briefingEnabled: boolean;
  briefingTime: string;
};

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
  const [draft, setDraft] = useState<Channels | null>(null);
  const values = draft ?? {
    email: settings.email,
    briefingEmail: settings.briefingEmail,
    briefingEnabled: settings.briefingAtMinute !== null,
    briefingTime: asTime(settings.briefingAtMinute ?? 420),
  };
  const briefingAtMinute = values.briefingEnabled
    ? asMinute(values.briefingTime)
    : null;
  const dirty =
    pushDirty ||
    values.email !== settings.email ||
    values.briefingEmail !== settings.briefingEmail ||
    briefingAtMinute !== settings.briefingAtMinute;
  useEffect(() => {
    onDirtyChange(dirty || pending);
  }, [dirty, pending, onDirtyChange]);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          pushDirty &&
          !(await (pushEnabled ? push.turnOn() : push.turnOff()))
        )
          return;
        update.mutate(
          {
            email: values.email,
            briefingEmail: values.briefingEmail,
            ...(briefingAtMinute !== settings.briefingAtMinute
              ? { briefingAtMinute }
              : {}),
          },
          {
            onSuccess: () => {
              setDraft(null);
              setPushDraft(null);
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
                setDraft(null);
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
                checked={values.email}
                onCheckedChange={(email) => setDraft({ ...values, email })}
              />
              E-Mail
            </label>
            <label
              htmlFor={`${id}-briefing-email`}
              className="ml-7 flex items-center gap-3 has-disabled:opacity-50"
            >
              <Checkbox
                id={`${id}-briefing-email`}
                checked={values.briefingEmail}
                disabled={!values.email}
                onCheckedChange={(briefingEmail) =>
                  setDraft({ ...values, briefingEmail })
                }
              />
              Tägliches Briefing auch per E-Mail erhalten
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
            <div className="mt-2 flex flex-col gap-4 border-t border-base-200 pt-4">
              <label
                htmlFor={`${id}-briefing`}
                className="flex items-center gap-3"
              >
                <Checkbox
                  id={`${id}-briefing`}
                  checked={values.briefingEnabled}
                  onCheckedChange={(briefingEnabled) =>
                    setDraft({ ...values, briefingEnabled })
                  }
                />
                Tägliches Briefing erhalten
              </label>
              <div className="ml-7 flex flex-col gap-2">
                <label htmlFor={`${id}-time`}>Tägliches Briefing um</label>
                <InputGroup>
                  <InputGroupInput
                    id={`${id}-time`}
                    type="time"
                    required
                    disabled={!values.briefingEnabled}
                    value={values.briefingTime}
                    onChange={(event) =>
                      setDraft({ ...values, briefingTime: event.target.value })
                    }
                  />
                  <InputGroupAddon align="inline-end">Uhr</InputGroupAddon>
                </InputGroup>
                <p className="text-base-500">
                  Die Zeiten gelten in der Zeitzone deines Plans. E-Mails
                  enthalten nur einen Hinweis auf deinen Posteingang.
                </p>
              </div>
            </div>
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
