import "@nunio/ui/styles.css";
import type { ReactNode } from "react";

export const metadata = { title: "nunio" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="isolate">{children}</body>
    </html>
  );
}
