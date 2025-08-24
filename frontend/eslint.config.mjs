// @ts-check
import withNuxt from './node_modules/.cache/nuxt/.nuxt/eslint.config.mjs'

export default withNuxt(
  // Your custom configs here
  {
    rules: {
      'vue/no-multiple-template-root': 'off',
    },
  },
)
