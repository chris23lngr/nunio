"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { useSidebar } from "@nunio/ui/components/sidebar/sidebar";
import { Skeleton } from "@nunio/ui/components/skeleton/skeleton";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, Gauge, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOutMutation } from "@/features/settings/api/session-mutations";
import { authClient } from "@/lib/auth-client";

function Initials({ name, large = false }: { name: string; large?: boolean }) {
  const words = name.trim().split(/\s+/);
  const initials =
    `${words[0]?.[0] ?? ""}${words.length > 1 ? (words.at(-1)?.[0] ?? "") : ""}`.toLocaleUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-md bg-primary-100 font-medium text-primary-600 ${large ? "size-8 text-sm" : "size-6 text-xs"}`}
    >
      {initials}
    </span>
  );
}

export function UserMenu({ apiOrigin }: { apiOrigin: string }) {
  const session = authClient(apiOrigin).useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    ...signOutMutation(apiOrigin),
    onSuccess: () => {
      queryClient.clear();
      router.replace("/sign-in");
      router.refresh();
    },
  });
  const { setOpenMobile } = useSidebar();
  const user = session.data?.user;

  if (!user) {
    if (session.error) {
      return (
        <Button
          variant="ghost"
          className="h-9"
          aria-label="Benutzermenü erneut laden"
          onClick={() => void session.refetch()}
        >
          Erneut laden
        </Button>
      );
    }
    return session.isPending ? (
      <Skeleton
        className="h-9 min-w-0 flex-1"
        aria-label="Benutzermenü wird geladen"
      />
    ) : null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={user.name}
        render={
          <Button
            variant="ghost"
            className="h-9 min-w-0 shrink gap-0 rounded-[10px] py-1.5 pr-2 pl-1.5 text-sm leading-5 hover:bg-base-200 hover:text-base-800"
          />
        }
      >
        <Initials name={user.name} />
        <span className="ml-2.5 min-w-0 truncate">{user.name}</span>
        <ChevronDown aria-hidden="true" className="ml-1.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        alignOffset={6}
        sideOffset={9}
        className="max-w-(--available-width)"
      >
        <div className="flex flex-col items-center px-2.5 py-5">
          <Initials name={user.name} large />
          <p className="mt-3 max-w-full text-center text-sm font-medium wrap-anywhere text-base-700">
            {user.name}
          </p>
          <p className="mt-0.5 max-w-full text-center text-xs wrap-anywhere text-base-500">
            {user.email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            render={<Link href="/settings/security" />}
            onClick={() => setOpenMobile(false)}
          >
            <Settings aria-hidden="true" />
            Einstellungen
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Gauge aria-hidden="true" />
            Nutzung
          </DropdownMenuItem>
          <DropdownMenuItem className="text-primary-600">
            <ArrowUp aria-hidden="true" className="text-primary-500" />
            Upgrade durchführen
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={false}
            disabled={signOut.isPending}
            onClick={() => signOut.mutate(false)}
          >
            <LogOut aria-hidden="true" />
            Abmelden
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {signOut.error && (
          <p
            role="alert"
            className="max-w-xs px-2.5 pb-2 text-sm text-destructive-700"
          >
            {signOut.error.message}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
