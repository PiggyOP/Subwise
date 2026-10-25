import React, { createContext, useContext, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
const ThemeContext = createContext(null);
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("subwise.theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("subwise.theme", theme);
    } catch {}
  }, [theme]);
  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggle: () =>
          setTheme((value) => (value === "dark" ? "light" : "dark")),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeToggle({ className = "" }) {
  const { theme, toggle } = useContext(ThemeContext),
    dark = theme === "dark";
  return (
    <button
      type="button"
      className={"theme-toggle " + className}
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
      <span>{dark ? "Light" : "Dark"}</span>
    </button>
  );
}
