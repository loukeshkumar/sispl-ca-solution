"use client";

import { DashboardIcon } from "../dashboard/dashboard-icons";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} theme`;

  return (
    <button aria-label={label} className="theme-toggle icon-button" onClick={toggleTheme} title={label} type="button">
      <DashboardIcon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
