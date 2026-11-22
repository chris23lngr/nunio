"use client";

import { useState } from "react";
import { useLeave } from "@/app/providers";
import { forgetOpenChat } from "@/features/chat/open-chat-cookie";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ apiOrigin }: { apiOrigin: string }) {
  const leave = useLeave();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const result = await authClient(apiOrigin).signOut();
          if (result.error)
            return setError("Could not sign out. Please try again.");
          forgetOpenChat();
          leave("/sign-in");
        }}
      >
        Sign out
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
