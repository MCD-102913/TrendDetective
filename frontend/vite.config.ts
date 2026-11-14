import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Dev server proxies /api to the backend. Against a remote backend: API_TARGET=https://backend.example.com npm run dev
const target = process.env.API_TARGET ?? 'http://127.0.0.1:8000'

// ECharts writes its Apache 2.0 header as a plain comment, which the minifier drops; its NOTICE has to ship with the code
function echartsNotice(): Plugin {
  const notice = readFileSync(new URL('./node_modules/echarts/NOTICE', import.meta.url), 'utf8').trim()
  const lines = notice.split('\n').map((line) => ` * ${line}`.trimEnd())
  const banner = `/*!\n${lines.join('\n')}\n * Licensed under the Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0\n */\n`
  return {
    name: 'echarts-notice',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.moduleIds.some((id) => id.includes('/node_modules/echarts/'))) chunk.code = banner + chunk.code
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), echartsNotice()],
  server: {
    proxy: { '/api': { target, changeOrigin: true, secure: true } },
  },
  // keep the copyright notices of the libraries (React, MapLibre, ZRender) in the minified files
  build: { rolldownOptions: { output: { comments: { legal: true } } } },
})
