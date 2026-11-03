"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ apiOrigin }: { apiOrigin: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const result = await authClient(apiOrigin).signOut();
          if (result.error) return setError("Could not sign out. Please try again.");
          queryClient.clear();
          router.replace("/sign-in");
          router.refresh();
        }}
      >
        Sign out
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
