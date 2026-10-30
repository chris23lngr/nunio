import { apiOrigin } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ invitation?: string; error?: string; reset?: string; deletion?: string }>;
}) {
  const { invitation, error, reset, deletion } = await searchParams;
  const initialError = error ? "That verification link could not be used. Sign in to request a new one." : undefined;
  const initialNotice = reset === "success"
    ? "Your password has been reset. Sign in with your new password."
    : deletion === "requested"
      ? "Your account deletion request was received. You have been signed out everywhere."
      : undefined;
  return (
    <main>
      <SignInForm apiOrigin={apiOrigin()} invitation={invitation} initialNotice={initialNotice} initialError={initialError} />
    </main>
  );
}
