import type { ComponentType } from 'react'
import { ExpensesIcon, InventoryIcon, MarketIcon, OverviewIcon, SalesIcon } from '../ui/Icons'

export const navItems: { to: string; label: string; end?: boolean; Icon: ComponentType<{ className?: string }> }[] = [
  { to: '/', label: 'Overview', end: true, Icon: OverviewIcon },
  { to: '/inventory', label: 'Inventory', Icon: InventoryIcon },
  { to: '/sales', label: 'Sales', Icon: SalesIcon },
  { to: '/expenses', label: 'Expenses', Icon: ExpensesIcon },
  { to: '/market', label: 'Market', Icon: MarketIcon },
]
