"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useState } from "react";
import { PageHeading } from "@/components/headings";
import { useOutreachSettings } from "@/features/inbox/use-outreach-settings";
import { NotificationChannels } from "./components/notification-channels";
import { QuietHoursSettings } from "./components/quiet-hours-settings";
import { SettingsNavigation } from "./components/settings-navigation";
import { useUnsavedChanges } from "./use-unsaved-changes";

export function NotificationsScreen({ apiOrigin }: { apiOrigin: string }) {
  const { query } = useOutreachSettings(apiOrigin);
  const [channelsDirty, setChannelsDirty] = useState(false);
  const [quietDirty, setQuietDirty] = useState(false);
  useUnsavedChanges(channelsDirty || quietDirty);
  return (
    <main className="mx-auto w-full max-w-[1408px] px-4 py-8 text-base-800 sm:px-8 lg:px-16 lg:py-10">
      <PageHeading className="max-md:pt-8">Einstellungen</PageHeading>
      <div className="mt-8 flex flex-col items-start gap-8 xl:mt-16 xl:flex-row">
        <SettingsNavigation active="notifications" />
        <div className="flex w-full min-w-0 flex-1 flex-col gap-16">
          {query.isPending && (
            <p role="status" className="text-sm text-base-500">
              Einstellungen werden geladen…
            </p>
          )}
          {query.error && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm text-destructive-700">
                Die Einstellungen konnten nicht geladen werden.
              </p>
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                Erneut versuchen
              </Button>
            </div>
          )}
          {query.data && (
            <>
              <NotificationChannels
                apiOrigin={apiOrigin}
                settings={query.data}
                onDirtyChange={setChannelsDirty}
              />
              <QuietHoursSettings
                apiOrigin={apiOrigin}
                settings={query.data}
                onDirtyChange={setQuietDirty}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
