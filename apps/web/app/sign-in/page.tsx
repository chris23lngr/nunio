import { apiOrigin } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main>
      <SignInForm apiOrigin={apiOrigin()} />
    </main>
  );
}
