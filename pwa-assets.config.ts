import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Regenerate the app icons in public/ from the favicon: npx pwa-assets-generator
const paper = { background: '#efe6d8', fit: 'contain' } as const

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: paper },
    apple: { ...minimal2023Preset.apple, resizeOptions: paper },
  },
  images: ['public/favicon.svg'],
})
