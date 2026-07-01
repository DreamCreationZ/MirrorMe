import "./globals.css";
import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";

export const metadata: Metadata = {
  title: "MirrorMe",
  description: "MirrorMe AI stylist with closet inventory and virtual try-on"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="app-shell">
          <AppNav />
          {children}
        </main>
      </body>
    </html>
  );
}
