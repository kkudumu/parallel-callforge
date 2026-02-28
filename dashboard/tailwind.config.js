/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        kawaii: {
          pink: "#FFB5C2",
          "pink-light": "#FFD4DC",
          "pink-dark": "#FF8FA3",
          sky: "#B5D8FF",
          "sky-light": "#D4E8FF",
          "sky-dark": "#8FC4FF",
          mint: "#B5FFCF",
          "mint-light": "#D4FFE2",
          "mint-dark": "#8FFFB5",
          peach: "#FFD4B5",
          "peach-light": "#FFE4D4",
          "peach-dark": "#FFC08F",
          lavender: "#E8D4FF",
          "lavender-light": "#F0E4FF",
          "lavender-dark": "#D4B5FF",
          bg: "#FDF4FF",
          "bg-alt": "#F8EDFF",
          surface: "#FFFFFF",
          "surface-alt": "#FFF8FC",
          text: "#4A3560",
          "text-muted": "#8B7AA0",
        },
      },
      fontFamily: {
        nunito: ["Nunito", "sans-serif"],
      },
      borderRadius: {
        kawaii: "16px",
        "kawaii-lg": "24px",
      },
      boxShadow: {
        kawaii: "0 4px 20px rgba(138, 92, 200, 0.1)",
        "kawaii-hover": "0 8px 30px rgba(138, 92, 200, 0.15)",
      },
    },
  },
  plugins: [],
};
