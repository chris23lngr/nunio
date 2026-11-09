import "@nunio/ui/styles.css";
import type { ReactNode } from "react";

import { apiOrigin, getSession } from "@/lib/session";
import { SessionBoundary } from "@/features/auth/session-boundary";
import { Providers } from "./providers";

export const metadata = { title: "nunio" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <html lang="de">
      <body className="isolate">
        <Providers>
          <SessionBoundary apiOrigin={apiOrigin()} initialSessionId={session?.session.id ?? null}>
            {children}
          </SessionBoundary>
        </Providers>
      </body>
    </html>
  );
}
