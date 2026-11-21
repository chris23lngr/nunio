import { SignInScreen } from "@/features/auth/sign-in-screen";
import { apiOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string; deletion?: string }>;
}) {
  const { invitation, deletion } = await searchParams;
  const initialNotice =
    deletion === "requested"
      ? "Deine Anfrage zur Kontolöschung ist eingegangen. Du wurdest auf allen Geräten abgemeldet."
      : undefined;
  return (
    <SignInScreen
      apiOrigin={apiOrigin()}
      invitation={invitation}
      initialNotice={initialNotice}
    />
  );
}
