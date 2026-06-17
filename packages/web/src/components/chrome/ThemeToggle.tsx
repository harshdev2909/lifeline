import { Moon, Sun } from "lucide-react";
import { useState } from "react";

import { getTheme, toggleTheme, type Theme } from "../../lib/theme";
import { IconButton } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";

export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  return (
    <Tooltip content={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
      <IconButton label="Toggle theme" onClick={() => setThemeState(toggleTheme())}>
        {theme === "dark" ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
      </IconButton>
    </Tooltip>
  );
}
