import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { Roleplay } from './pages/Roleplay'
import { Feedback } from './pages/Feedback'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/roleplay" element={<Roleplay />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
