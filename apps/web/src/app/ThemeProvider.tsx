import { createContext, useContext, useEffect, useState } from "react";
import type { Theme } from "@workbench/contracts";
import { api } from "../lib/api";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: React.ReactNode;
  initialTheme?: Theme;
  onSave?: (theme: Theme) => Promise<void>;
}

export function ThemeProvider({ children, initialTheme, onSave }: ThemeProviderProps) {
  const [theme, setCurrentTheme] = useState<Theme>(initialTheme ?? "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (initialTheme) return;
    api.getTheme().then(({ theme: savedTheme }) => setCurrentTheme(savedTheme)).catch(() => undefined);
  }, [initialTheme]);

  async function setTheme(nextTheme: Theme) {
    setCurrentTheme(nextTheme);
    await (onSave ? onSave(nextTheme) : api.updateTheme(nextTheme));
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
