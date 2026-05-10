import type { Metadata, Viewport } from "next";

import { Figtree, Spline_Sans_Mono } from "next/font/google";
import { CopilotKitProviderShell } from "@/components/copilot/CopilotKitProviderShell";
import "./globals.css";
// v2 owns its own stylesheet. Do NOT import @copilotkit/react-ui/styles.css —
// v1's .copilotKitButton / .copilotKitSidebar / .copilotKitWindow rules
// collide with v2's same-name selectors (different DOM, different positioning)
// and break the sidebar layout when both are loaded.
import "@copilotkit/react-core/v2/styles.css";
// gpilot-specific overrides — minimalist chat: hairline borders, square
// edges, no shadows, no extra colour. Loaded LAST so it wins over the
// CopilotKit defaults above.
import "./copilot-overrides.css";

const figtree = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figtree",
});

const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  // Brand: lowercase wordmark in the UI ("gpilot."), title-case in OS chrome
  // (browser tab, iOS home-screen, Cmd-Tab) so it doesn't read as a typo.
  applicationName: "Gpilot",
  title: {
    default: "Gpilot",
    template: "%s · Gpilot",
  },
  description: "Agentic interface for Google Cloud.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Gpilot",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EFEFEF" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0B" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${figtree.variable} ${splineMono.variable}`}>
      <body className={`${figtree.variable} ${splineMono.variable} subpixel-antialiased`}>
        <CopilotKitProviderShell>{children}</CopilotKitProviderShell>
      </body>
    </html>
  );
}
