import { apiOrigin } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ invitation?: string; error?: string; reset?: string; deletion?: string }>;
}) {
  const { invitation, error, reset, deletion } = await searchParams;
  return (
    <main>
      <SignInForm apiOrigin={apiOrigin()} invitation={invitation} verificationError={Boolean(error)} passwordReset={reset === "success"} deletionRequested={deletion === "requested"} />
    </main>
  );
}
