import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LangProvider } from './i18n'
import { Root } from './Root'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Root />
    </LangProvider>
  </StrictMode>,
)
