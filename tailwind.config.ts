import type { Config } from 'tailwindcss'
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        neon: {
          pink: "#FF3B81",
          blue: "#00B7ED"
        },
        bg: "#0A0A0A"
      }
    }
  },
  plugins: []
}
export default config
