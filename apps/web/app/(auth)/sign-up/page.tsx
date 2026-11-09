import { SignUpScreen } from "@/features/auth/sign-up-screen";
import { apiOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignUpPage({ searchParams }: {
  searchParams: Promise<{ invitation?: string }>;
}) {
  const { invitation } = await searchParams;
  return <SignUpScreen apiOrigin={apiOrigin()} invitation={invitation} />;
}
