import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        block: "#6366f1", // indigo — our auto-scheduled blocks
      },
    },
  },
  plugins: [],
} satisfies Config;
