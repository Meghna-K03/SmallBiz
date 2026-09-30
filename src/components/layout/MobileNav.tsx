import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { ShopProfileButton } from '../profile/ShopProfileButton'
import { LogoMark } from '../ui/Icons'
import { navItems } from './nav'

export function MobileNav() {
  const { signOut } = useAuth()
  return (
    <div className="bg-slate-900 md:hidden">
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-7 w-7" />
          <span className="font-display text-base font-semibold text-white">SmallBiz Lens</span>
        </div>
        <div className="flex items-center gap-2">
          <ShopProfileButton variant="mobile" />
          <button type="button" onClick={signOut} className="text-xs text-slate-400 hover:text-slate-100">
            Sign out
          </button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 py-2.5" aria-label="Main">
        {navItems.map(({ to, label, end, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-100'
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
