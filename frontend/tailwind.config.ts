import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: {
    colors: {
      ink: "#0b1220",
      panel: "#111c2e",
      accent: "#55b8ff",
      mint: "#6ee7c1"
    },
    boxShadow: { glow: "0 0 40px rgba(65,165,255,.13)" }
  }},
  plugins: []
};
export default config;
