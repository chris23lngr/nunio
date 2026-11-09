import { SignInScreen } from "@/features/auth/sign-in-screen";
import { apiOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    invitation?: string;
    error?: string;
    reset?: string;
    deletion?: string;
  }>;
}) {
  const { invitation, error, reset, deletion } = await searchParams;
  const initialError = error
    ? "Dieser Bestätigungslink ist ungültig oder abgelaufen. Melde dich an, um eine neue E-Mail anzufordern."
    : undefined;
  const initialNotice =
    reset === "success"
      ? "Dein Passwort wurde zurückgesetzt. Melde dich mit deinem neuen Passwort an."
      : deletion === "requested"
        ? "Deine Anfrage zur Kontolöschung ist eingegangen. Du wurdest auf allen Geräten abgemeldet."
        : undefined;
  return (
    <SignInScreen
      apiOrigin={apiOrigin()}
      invitation={invitation}
      initialNotice={initialNotice}
      initialError={initialError}
    />
  );
}
