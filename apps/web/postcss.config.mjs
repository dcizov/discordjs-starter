import { fileURLToPath } from "node:url";
const config = {
  plugins: {
    tailwindcss: {
      config: fileURLToPath(new URL("./tailwind.config.ts", import.meta.url)),
    },
    autoprefixer: {},
  },
};

export default config;
