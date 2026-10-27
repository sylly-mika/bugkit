import type { ReactNode } from "react";
import { BugReport } from "@sylly-mika/bugkit/next";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <BugReport version={process.env.NEXT_PUBLIC_BUILD_SHA} />
      </body>
    </html>
  );
}
