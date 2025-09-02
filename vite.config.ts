import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // content script だけをビルド（必要に応じて background なども追加可能）
      input: {
        content: resolve(__dirname, 'src/content/main.tsx'),
      },
      output: {
        // manifest.json で参照しやすいよう固定名に
        entryFileNames: (chunk) =>
          chunk.name === 'content' ? 'content.js' : '[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'content.css'
          return '[name].[ext]'
        }
      }
    }
  }
})
