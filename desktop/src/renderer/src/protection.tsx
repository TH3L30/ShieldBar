import React from 'react'
import ReactDOM from 'react-dom/client'
import { ProtectionApp } from './ProtectionApp'
import './protection.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ProtectionApp />
  </React.StrictMode>
)
