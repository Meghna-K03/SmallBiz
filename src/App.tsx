import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { DataProvider } from './context/DataContext'
import { Dashboard } from './pages/Dashboard'
import { Inventory } from './pages/Inventory'
import { Sales } from './pages/Sales'
import { Expenses } from './pages/Expenses'

function App() {
  return (
    <DataProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="sales" element={<Sales />} />
            <Route path="expenses" element={<Expenses />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </DataProvider>
  )
}

export default App
