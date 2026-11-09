"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/headings";
import { deletionMutation } from "./api/deletion-mutation";
import {
  revokeSessionMutation,
  signOutMutation,
} from "./api/session-mutations";
import { sessionQueries } from "./api/session-queries";
import { DeletionDialog } from "./components/deletion-dialog";
import { SessionList } from "./components/session-list";
import { SettingGroup } from "./components/setting-group";
import { SettingsNavigation } from "./components/settings-navigation";

export function SecurityScreen({ apiOrigin }: { apiOrigin: string }) {
  const sessions = useQuery(sessionQueries(apiOrigin));
  const queryClient = useQueryClient();
  const router = useRouter();
  const revoke = useMutation({
    ...revokeSessionMutation(apiOrigin),
    onSuccess: () => queryClient.invalidateQueries(sessionQueries(apiOrigin)),
  });
  const signOut = useMutation({
    ...signOutMutation(apiOrigin),
    onSuccess: () => {
      queryClient.clear();
      router.replace("/sign-in");
      router.refresh();
    },
  });
  const deletion = useMutation({
    ...deletionMutation(apiOrigin),
    onSuccess: () => {
      queryClient.clear();
      router.replace("/sign-in?deletion=requested");
      router.refresh();
    },
  });
  return (
    <main className="mx-auto w-full max-w-[1408px] px-4 py-8 text-base-800 sm:px-8 lg:px-16 lg:py-10">
      <PageHeading>Einstellungen</PageHeading>
      <div className="mt-8 flex flex-col items-start gap-8 xl:mt-16 xl:flex-row">
        <SettingsNavigation />
        <div className="flex w-full min-w-0 flex-1 flex-col gap-16">
          <SettingGroup
            title="Aktive Sitzungen"
            footer={
              <Button
                variant="destructive"
                disabled={
                  !sessions.data || revoke.isPending || signOut.isPending
                }
                onClick={() => signOut.mutate(true)}
              >
                Überall abmelden
              </Button>
            }
          >
            {sessions.isPending && (
              <p role="status" className="text-sm text-base-500">
                Sitzungen werden geladen…
              </p>
            )}
            {sessions.error && (
              <div className="flex flex-col items-start gap-3">
                <p role="alert" className="text-sm text-destructive-700">
                  {sessions.error.message}
                </p>
                <Button
                  variant="outline"
                  disabled={sessions.isFetching}
                  onClick={() => void sessions.refetch()}
                >
                  Erneut versuchen
                </Button>
              </div>
            )}
            {sessions.data && (
              <SessionList
                {...sessions.data}
                onSignOut={(token) =>
                  token === sessions.data.currentToken
                    ? signOut.mutate(false)
                    : revoke.mutate(token)
                }
                signingOut={revoke.isPending || signOut.isPending}
              />
            )}
            {revoke.error && (
              <p role="alert" className="mt-4 text-sm text-destructive-700">
                {revoke.error.message}
              </p>
            )}
            {signOut.error && (
              <p role="alert" className="mt-4 text-sm text-destructive-700">
                {signOut.error.message}
              </p>
            )}
          </SettingGroup>
          <SettingGroup title="Gefahrenbereich">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between sm:gap-6">
              <div className="max-w-lg">
                <h3 className="text-sm leading-5 font-medium text-destructive-700">
                  Konto löschen
                </h3>
                <p className="mt-0.5 text-sm leading-5 text-base-500">
                  Fordere die Löschung deines Kontos und deiner Daten an. Die
                  Löschung wird manuell abgeschlossen.
                </p>
              </div>
              <DeletionDialog
                onSubmit={(password) => deletion.mutateAsync(password)}
                onReset={() => deletion.reset()}
                pending={deletion.isPending}
                error={deletion.error?.message}
              />
            </div>
          </SettingGroup>
        </div>
      </div>
    </main>
  );
}
