// @ts-check
import withNuxt from "./node_modules/.cache/nuxt/.nuxt/eslint.config.mjs";

export default withNuxt(
  // Your custom configs here
  {
    ignores: [
      "**/coverage/**",
      "app/coverage/**",
      "backstop_data/**",
      "**/.nuxt/**",
      "**/.output/**",
      "**/dist/**",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "vue/no-multiple-template-root": "off",
      "vue/no-mutating-props": "off", // TODO enable it again
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
)
  .append({
    files: ["**/*.ts", "**/*.vue"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "warn",
    },
  })
  .append({
    files: ["cypress/**/*.ts", "cypress.config.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  });
