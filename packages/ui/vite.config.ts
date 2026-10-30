import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundle up front: discovering these mid-run makes Vite reload and fail the
  // first Vitest browser run on a cold cache
  optimizeDeps: {
    include: [
      "@base-ui/react/button",
      "@base-ui/react/collapsible",
      "@base-ui/react/dialog",
      "@base-ui/react/field",
      "@base-ui/react/input",
      "@base-ui/react/menu",
      "@base-ui/react/merge-props",
      "@base-ui/react/popover",
      "@base-ui/react/select",
      "@base-ui/react/switch",
      "@base-ui/react/tabs",
      "@base-ui/react/tooltip",
      "@base-ui/react/use-render",
      "class-variance-authority",
      "lucide-react",
      "motion/react",
    ],
  },
})
