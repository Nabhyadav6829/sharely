
// /src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
// import App from './App'
import HomePage from './components/HomePage'
import './index.css'
import CreateRoom from './components/CreateRoom'
import Global from './components/GlobalShare'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/globalshare" element={<Global />} />
        <Route path="/createroom" element={<CreateRoom />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
