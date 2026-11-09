import Link from "next/link";
import { apiOrigin } from "@/lib/session";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return (
    <main>
      <h1>Reset your password</h1>
      {token && !error ? (
        <ResetPasswordForm apiOrigin={apiOrigin()} token={token} />
      ) : (
        <p>
          This reset link is invalid or expired. Return to sign in to request a
          new one.
        </p>
      )}
      <Link href="/sign-in">Return to sign in</Link>
    </main>
  );
}
