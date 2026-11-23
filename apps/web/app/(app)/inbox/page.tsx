import { cn } from "@nunio/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { buttonVariants } from "@nunio/ui/components/button/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InboxScreen } from "@/features/inbox/inbox-screen";
import { PageHeader } from "@/features/shared/components/page-header";
import { apiOrigin, getSession } from "@/lib/session";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Eingang</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <span className="flex-1" />
        <Link
          href="/settings/notifications"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Benachrichtigungen einstellen
        </Link>
      </PageHeader>
      <InboxScreen apiOrigin={apiOrigin()} />
    </main>
  );
}
