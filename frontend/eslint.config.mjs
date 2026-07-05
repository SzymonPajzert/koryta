// @ts-check
import withNuxt from "./.nuxt/eslint.config.mjs";

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
      "functions/lib/**",
      "**/.agent/**",
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
      "vue/no-mutating-props": "error",
      "vue/html-self-closing": "off",
      "no-restricted-syntax": [
        "error",
        {
          // This AST selector looks for:
          // 1. An 'await' keyword
          // 2. Calling useFetch, authFetch, or useAsyncData
          // 3. Passing an object containing `lazy: true`
          selector:
            "AwaitExpression > CallExpression[callee.name=/^(useFetch|authFetch|useAsyncData)$/] > ObjectExpression > Property[key.name='lazy'][value.value=true]",
          message:
            "⚠️ Nuxt Documentation strictly forbids awaiting a lazy fetch. Using 'await' with 'lazy: true' suspends the setup function during SSR, breaks hydration, and defeats the purpose of background fetching. Drop the 'await'!",
        },
        {
          selector: "AwaitExpression > ImportExpression",
          message: "⚠️ Using `await import()` is banned in this codebase.",
        },
      ],
    },
  },
)
  .append({
    files: ["**/*.ts", "**/*.vue"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "error",
    },
  })
  .append({
    files: [
      "cypress/**/*.ts",
      "cypress.config.ts",
      "**/*.test.ts",
      "tests/**",
      "**/sentry.client.config.ts",
    ],
    rules: {
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  });
