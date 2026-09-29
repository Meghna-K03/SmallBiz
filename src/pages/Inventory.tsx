import { useState } from 'react'
import { Header } from '../components/layout/Header'
import { DataGate } from '../components/ui/DataGate'
import { ProductsSection } from '../components/inventory/ProductsSection'
import { PurchasesSection } from '../components/inventory/PurchasesSection'

type Tab = 'products' | 'purchases'

const tabs: { id: Tab; label: string }[] = [
  { id: 'products', label: 'Products' },
  { id: 'purchases', label: 'Purchases & Restocking' },
]

export function Inventory() {
  const [activeTab, setActiveTab] = useState<Tab>('products')

  return (
    <>
      <Header title="Inventory" />
      <main className="flex-1 space-y-6 p-5">
        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <DataGate>{activeTab === 'products' ? <ProductsSection /> : <PurchasesSection />}</DataGate>
      </main>
    </>
  )
}
