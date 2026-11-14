import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev server proxies /api to the backend. Against a remote backend: API_TARGET=https://backend.example.com npm run dev
const target = process.env.API_TARGET ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target, changeOrigin: true, secure: true } },
  },
})
