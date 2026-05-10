"use client";

import { ThemeProvider } from "@/hooks/use-theme";

/**
 * App-wide client providers. Lives in the root layout so state (theme, etc.)
 * survives Next.js client navigations — per-page providers remount and reset.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
