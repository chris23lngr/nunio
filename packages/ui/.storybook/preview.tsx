import { withThemeByClassName } from "@storybook/addon-themes"
import type { Preview } from "@storybook/react-vite"

import "../src/styles/globals.css"

const preview: Preview = {
  decorators: [
    withThemeByClassName({
      themes: { light: "", dark: "dark" },
      defaultTheme: "light",
    }),
    // Base UI portals need an isolated stacking context at the app root
    (Story) => (
      <div className="isolate">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    a11y: {
      test: "error",
      // Notion's own grays (e.g. texSec on white) fall below AA; fidelity wins
      config: { rules: [{ id: "color-contrast", enabled: false }] },
    },
  },
}

export default preview
