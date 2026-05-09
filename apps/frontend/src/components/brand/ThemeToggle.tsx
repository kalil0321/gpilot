"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { useTheme } from "@/hooks/use-theme";

interface ThemeToggleProps {
  /** Smaller variant, e.g. for embedded toolbars. */
  size?: "default" | "sm";
}

/**
 * Compact light/dark switcher. Reads the current resolved scheme from
 * the `<html class="light|dark">` token the ThemeProvider hook sets,
 * and toggles via setTheme(...). Stays a pure ghost button — uses
 * --foreground / --muted on hover, no fill, no border.
 */
export function ThemeToggle({ size = "default" }: ThemeToggleProps) {
  const { setTheme } = useTheme();
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const detect = () => {
      setResolved(root.classList.contains("dark") ? "dark" : "light");
    };
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const isDark = resolved === "dark";

  const dim = size === "sm" ? 14 : 16;
  const box = size === "sm" ? "size-7" : "size-8";

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`grid ${box} place-items-center rounded-md transition-colors hover:bg-muted`}
      style={{ color: "var(--muted-foreground)" }}
    >
      {isDark ? <Sun size={dim} /> : <Moon size={dim} />}
    </button>
  );
}
