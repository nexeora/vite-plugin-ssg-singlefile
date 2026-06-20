import { defineConfig } from 'vite'
import dts from 'unplugin-dts/vite'


export default defineConfig({
  plugins: [
    dts()
  ],
  build: {
    minify: "terser",
    target: "node20",
    ssr: true,
    lib: {
      entry: './lib/main.ts',
      formats: ['es'],
      fileName: 'main',
    },
  },
})
