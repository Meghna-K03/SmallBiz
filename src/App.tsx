import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { Dashboard } from './pages/Dashboard'
import { Inventory } from './pages/Inventory'
import { Login } from './pages/Login'
import { Market } from './pages/Market'
import { Sales } from './pages/Sales'
import { Expenses } from './pages/Expenses'

/** Everything except /login needs the (demo) sign-in. Shop data loads only once signed in. */
function Protected() {
  const { status } = useAuth()
  if (status === 'checking') return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-300">Loading…</div>
  if (status === 'signedOut') return <Navigate to="/login" replace />
  return (
    <DataProvider>
      <AppLayout />
    </DataProvider>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route element={<Protected />}>
            <Route index element={<Dashboard />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="sales" element={<Sales />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="market" element={<Market />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
