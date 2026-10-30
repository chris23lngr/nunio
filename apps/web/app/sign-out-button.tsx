"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ apiOrigin }: { apiOrigin: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient(apiOrigin).signOut();
        router.replace("/sign-in");
      }}
    >
      Sign out
    </button>
  );
}
