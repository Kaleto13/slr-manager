import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App.jsx'
import './index.css'


if (window.location.protocol === 'file:') {
  axios.defaults.baseURL = 'http://127.0.0.1:8000'
  axios.interceptors.request.use(config => {
    if (config.url?.startsWith('/api')) {
      config.url = config.url.replace(/^\/api/, '') || '/'
    }
    return config
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
