import { SignUpScreen } from "@/features/auth/sign-up-screen";
import { apiOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string; email?: string }>;
}) {
  const { invitation, email } = await searchParams;
  return (
    <SignUpScreen
      apiOrigin={apiOrigin()}
      invitation={invitation}
      email={email}
    />
  );
}
