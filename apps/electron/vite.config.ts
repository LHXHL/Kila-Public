import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || (id.includes('/react/') && !id.includes('@'))) return 'vendor-react'
            if (id.includes('@radix-ui')) return 'vendor-radix'
            if (id.includes('@tiptap')) return 'vendor-tiptap'
            if (id.includes('react-markdown') || id.includes('rehype-') || id.includes('remark-')) return 'vendor-markdown'
            if (id.includes('recharts')) return 'vendor-recharts'
            if (id.includes('jotai')) return 'vendor-jotai'
            if (id.includes('mermaid') || id.includes('beautiful-mermaid')) return 'vendor-mermaid'
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    port: 5173,
    strictPort: true, // 确保使用指定端口，如被占用则报错
    open: false,
  },
})
