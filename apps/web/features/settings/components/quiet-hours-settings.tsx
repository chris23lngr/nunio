"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@nunio/ui/components/input-group/input-group";
import { useEffect, useId, useState } from "react";
import type { OutreachSettings } from "@/features/inbox/api/settings-queries";
import { useOutreachSettings } from "@/features/inbox/use-outreach-settings";
import { asMinute, asTime } from "@/lib/time";
import { SettingGroup } from "./setting-group";

type Draft = { limit: string; enabled: boolean; from: string; until: string };

export function QuietHoursSettings({
  apiOrigin,
  settings,
  onDirtyChange,
}: {
  apiOrigin: string;
  settings: OutreachSettings;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { update } = useOutreachSettings(apiOrigin);
  const [draft, setDraft] = useState<Draft | null>(null);
  const id = useId();
  const saved = {
    limit: String(settings.dailyLimit),
    enabled: settings.quietHours !== null,
    from: asTime(settings.quietHours?.fromMinute ?? 1320),
    until: asTime(settings.quietHours?.toMinute ?? 420),
  };
  const values = draft ?? saved;
  const dirty =
    values.limit !== saved.limit ||
    values.enabled !== saved.enabled ||
    (values.enabled &&
      (values.from !== saved.from || values.until !== saved.until));
  useEffect(() => {
    onDirtyChange(dirty || update.isPending);
  }, [dirty, update.isPending, onDirtyChange]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({
          dailyLimit: Number(values.limit),
          quietHours: values.enabled
            ? {
                fromMinute: asMinute(values.from),
                toMinute: asMinute(values.until),
              }
            : null,
        });
      }}
    >
      <SettingGroup
        title="Ruhezeiten"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || update.isPending}
              onClick={() => {
                setDraft(null);
                update.reset();
              }}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!dirty || update.isPending}
            >
              Speichern
            </Button>
          </>
        }
      >
        <fieldset
          disabled={update.isPending}
          className="flex min-w-0 flex-col gap-6 text-sm leading-5"
        >
          <div className="grid grid-cols-1 items-start gap-4 @2xl:grid-cols-2">
            <label htmlFor={`${id}-limit`} className="font-medium">
              Maximale Benachrichtigungen pro Tag
            </label>
            <div>
              <InputGroup>
                <InputGroupInput
                  id={`${id}-limit`}
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  required
                  value={values.limit}
                  onChange={(event) =>
                    setDraft({ ...values, limit: event.target.value })
                  }
                />
                <InputGroupAddon align="inline-end">
                  Benachrichtigungen
                </InputGroupAddon>
              </InputGroup>
              <p className="mt-2 text-base-500">
                0–50 pro Tag. Bei 0 werden keine Hinweise versendet. Briefings
                zählen nicht mit; dein Posteingang zeigt weiterhin alles.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 @2xl:grid-cols-2">
            <div>
              <label htmlFor={`${id}-enabled`} className="font-medium">
                Ruhezeiten aktivieren
              </label>
              <p className="mt-1 text-base-500">
                In den Ruhezeiten versendet nunio keine E-Mails oder
                Push-Benachrichtigungen. Zurückgehaltene Hinweise werden danach
                nur versendet, wenn sie noch zutreffen. Dein Posteingang zeigt
                sie sofort.
              </p>
            </div>
            <button
              id={`${id}-enabled`}
              type="button"
              role="switch"
              aria-checked={values.enabled}
              onClick={() => setDraft({ ...values, enabled: !values.enabled })}
              className={`relative h-4.5 w-8 justify-self-end rounded-full outline-1 outline-base-700/15 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-4 disabled:opacity-50 ${values.enabled ? "bg-primary-500" : "bg-white"}`}
            >
              <span
                className={`absolute top-0.5 size-3.5 rounded-full ${values.enabled ? "right-0.5 bg-white" : "left-0.5 bg-base-500"}`}
              />
            </button>
          </div>
          <div
            className={`grid grid-cols-1 items-start gap-4 @2xl:grid-cols-2 ${!values.enabled ? "opacity-50" : ""}`}
          >
            <div>
              <h3 className="font-medium">Ruhezeiten</h3>
              <p className="mt-1 text-base-500">
                Bestimme, in welcher Zeit du keine Benachrichtigungen erhalten
                möchtest.
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-3 @sm:flex-row @sm:items-center @sm:gap-4">
              <InputGroup>
                <InputGroupInput
                  type="time"
                  aria-label="Ruhezeiten von"
                  required
                  disabled={!values.enabled}
                  value={values.from}
                  onChange={(event) =>
                    setDraft({ ...values, from: event.target.value })
                  }
                />
                <InputGroupAddon align="inline-end">Uhr</InputGroupAddon>
              </InputGroup>
              <span aria-hidden="true" className="self-center text-base-300">
                –
              </span>
              <InputGroup>
                <InputGroupInput
                  type="time"
                  aria-label="Ruhezeiten bis"
                  required
                  disabled={!values.enabled}
                  value={values.until}
                  onChange={(event) =>
                    setDraft({ ...values, until: event.target.value })
                  }
                />
                <InputGroupAddon align="inline-end">Uhr</InputGroupAddon>
              </InputGroup>
            </div>
          </div>
        </fieldset>
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
