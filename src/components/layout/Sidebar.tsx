import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { ShopProfileButton } from '../profile/ShopProfileButton'
import { LogoMark, SignOutIcon } from '../ui/Icons'
import { navItems } from './nav'

export function Sidebar() {
  const { account, signOut } = useAuth()
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-slate-900 text-slate-300 md:flex">
      <div className="flex h-16 items-center gap-3 px-6">
        <LogoMark />
        <span className="font-display text-lg font-semibold text-white">SmallBiz Lens</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main">
        {navItems.map(({ to, label, end, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`h-5 w-5 ${isActive ? 'text-[#e08a63]' : ''}`} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 border-t border-white/10 p-4">
        <ShopProfileButton variant="sidebar" />
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100"
          title={account?.email}
        >
          <SignOutIcon className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
