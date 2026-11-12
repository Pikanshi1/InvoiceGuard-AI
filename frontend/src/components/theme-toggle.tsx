"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("light-theme"));
  }, []);

  function toggle() {
    const nextLight = !light;
    document.documentElement.classList.toggle("light-theme", nextLight);
    try { window.localStorage.setItem("invoiceguard-theme", nextLight ? "light" : "dark"); } catch { /* Keep the in-memory theme change. */ }
    setLight(nextLight);
  }

  return (
    <button
      type="button"
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      aria-pressed={light}
      onClick={toggle}
      className="theme-toggle"
    >
      <span className="sr-only">{light ? "Switch to dark theme" : "Switch to light theme"}</span>
      {light ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
