import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared lint rules for every nunio package and app. */
export default tseslint.config(
  { ignores: ["dist/**", ".next/**", "coverage/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Workspace packages are imported by name, never by reaching into another package's files.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../../*", "**/packages/*/src/**"], message: "Import workspace packages by name (@nunio/…)." },
          ],
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
