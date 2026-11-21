"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeading } from "@/components/headings";
import {
  SignInAgainDialog,
  SignInAgainError,
} from "@/features/auth/sign-in-again";
import { deletionMutation } from "./api/deletion-mutation";
import {
  addPasskeyMutation,
  deletePasskeyMutation,
  passkeyQueries,
} from "./api/passkey-queries";
import {
  revokeSessionMutation,
  signOutMutation,
} from "./api/session-mutations";
import { sessionQueries } from "./api/session-queries";
import { DeletionDialog } from "./components/deletion-dialog";
import { PasskeyList } from "./components/passkey-list";
import { SessionList } from "./components/session-list";
import { SettingGroup } from "./components/setting-group";
import { SettingsNavigation } from "./components/settings-navigation";

export function SecurityScreen({ apiOrigin }: { apiOrigin: string }) {
  const sessions = useQuery(sessionQueries(apiOrigin));
  const queryClient = useQueryClient();
  const router = useRouter();
  const revoke = useMutation(revokeSessionMutation(apiOrigin, queryClient));
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
    },
  });
  const passkeys = useQuery(passkeyQueries(apiOrigin));
  /** A sensitive action the API refused for an older session, to repeat once the student confirms with a code. */
  const [confirm, setConfirm] = useState<{
    description: string;
    retry: () => void;
  } | null>(null);
  const askCode =
    (description: string, retry: () => void) => (error: Error) => {
      if (error instanceof SignInAgainError) setConfirm({ description, retry });
    };
  const addPasskey = useMutation(addPasskeyMutation(apiOrigin, queryClient));
  const deletePasskey = useMutation(
    deletePasskeyMutation(apiOrigin, queryClient),
  );
  const deletionNeedsCode = deletion.error instanceof SignInAgainError;
  const email = sessions.data?.email ?? null;
  const visibleError = (error: Error | null) =>
    error && !(error instanceof SignInAgainError) ? error.message : null;
  const signOutEverywhere = () =>
    signOut.mutate(true, {
      onError: askCode(
        "Um dich überall abzumelden, gib den Code aus deiner E-Mail ein.",
        signOutEverywhere,
      ),
    });
  const addNewPasskey = () =>
    addPasskey.mutate(undefined, {
      onError: askCode(
        "Um einen Passkey hinzuzufügen, gib den Code aus deiner E-Mail ein.",
        addNewPasskey,
      ),
    });
  const removePasskey = (id: string) =>
    deletePasskey.mutate(id, {
      onError: askCode(
        "Um den Passkey zu löschen, gib den Code aus deiner E-Mail ein.",
        () => removePasskey(id),
      ),
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
                onClick={signOutEverywhere}
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
                sessions={sessions.data.sessions}
                currentToken={sessions.data.currentToken}
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
            {visibleError(signOut.error) && (
              <p role="alert" className="mt-4 text-sm text-destructive-700">
                {visibleError(signOut.error)}
              </p>
            )}
          </SettingGroup>
          <SettingGroup
            title="Passkeys"
            footer={
              <Button
                variant="outline"
                disabled={addPasskey.isPending}
                aria-busy={addPasskey.isPending}
                onClick={addNewPasskey}
              >
                Passkey hinzufügen
              </Button>
            }
          >
            {passkeys.isPending && (
              <p role="status" className="text-sm text-base-500">
                Passkeys werden geladen…
              </p>
            )}
            {passkeys.error && (
              <p role="alert" className="text-sm text-destructive-700">
                {passkeys.error.message}
              </p>
            )}
            {passkeys.data && (
              <PasskeyList
                passkeys={passkeys.data}
                onDelete={removePasskey}
                deleting={deletePasskey.isPending}
              />
            )}
            {(visibleError(addPasskey.error) ||
              visibleError(deletePasskey.error)) && (
              <p role="alert" className="mt-4 text-sm text-destructive-700">
                {visibleError(addPasskey.error) ??
                  visibleError(deletePasskey.error)}
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
                apiOrigin={apiOrigin}
                email={email}
                onSubmit={() => deletion.mutate()}
                onReset={() => deletion.reset()}
                pending={deletion.isPending}
                signInAgain={deletionNeedsCode}
                error={deletionNeedsCode ? undefined : deletion.error?.message}
              />
            </div>
          </SettingGroup>
        </div>
      </div>
      <SignInAgainDialog
        apiOrigin={apiOrigin}
        email={email}
        open={!!confirm}
        description={confirm?.description ?? ""}
        onClose={() => setConfirm(null)}
        onSignedIn={() => {
          const retry = confirm?.retry;
          setConfirm(null);
          retry?.();
        }}
      />
    </main>
  );
}
