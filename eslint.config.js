import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint"; // Import the typescript-eslint package

export default [
  // Generic ESLint recommended rules (good to include)
  // ...tseslint.configs.eslintRecommended, // You can choose to include this if you want ESLint's base recommended rules for TS

  // Vue recommended rules (ensure these are applied correctly)
  ...pluginVue.configs["flat/recommended"],

  // Configuration for TypeScript files
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.vue"], // Apply this configuration to .ts, .tsx, and .vue files
    extends: [
      // Recommended TypeScript ESLint rules
      ...tseslint.configs.recommended,
      // You might also consider 'strict' or 'recommended-type-checked' if you have type information setup
      // ...tseslint.configs.strict,
      // ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parser: tseslint.parser, // Specify the TypeScript parser
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Override/add Vue rules specific to your project
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/multi-word-component-names": "off",

      // Add or override TypeScript ESLint rules here
      // For example, if you want to disable a specific TS rule:
      // '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
