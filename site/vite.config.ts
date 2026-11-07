import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  // GitHub Pages serves this repository at https://kasia420.github.io/lost_in_translation/
  base: '/lost_in_translation/',
  server: {
    // the site reads its text from ../docs/portfolio_report.md and ../README.md
    fs: { allow: ['..'] },
  },
  build: {
    target: 'es2022',
    // the three.js chunk (~560 KB raw, ~140 KB gzip) is loaded only when the 3D chapter comes near
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      // only the public site is built; the design review (design/) stays a local dev page
      input: { main: page('./index.html') },
    },
  },
})
