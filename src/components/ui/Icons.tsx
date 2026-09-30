import type { ReactNode } from 'react'

/** Small stroke icons (24px grid). Decorative: always paired with a text label. */
function Svg({ children, className = 'h-5 w-5' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  )
}

type P = { className?: string }

export const OverviewIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
    <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
  </Svg>
)
export const InventoryIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" />
    <path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" />
  </Svg>
)
export const SalesIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 19V5M4 19h16" />
    <path d="m8 15 3.5-4 3 2.5L19 8" />
  </Svg>
)
export const ExpensesIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="6" width="17" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M7 9.5v.01M17 14.5v.01" />
  </Svg>
)
export const MarketIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5 5.5 4h13L20 9.5" />
    <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
    <path d="M5.5 12.5V20h13v-7.5" />
  </Svg>
)
export const SignOutIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h3" />
    <path d="M14 8l4 4-4 4M18 12H9" />
  </Svg>
)
export const StoreIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 10v9.5h16V10" />
    <path d="M3 10l1.5-5.5h15L21 10z" />
    <path d="M10 19.5v-5h4v5" />
  </Svg>
)

/** SmallBiz Lens mark: the shop/store logo (public/logo.png), on a round white backing so it reads on the dark sidebar. */
export function LogoMark({ className = 'h-8 w-8' }: P) {
  return <img src="/logo.png" alt="" aria-hidden="true" className={`${className} shrink-0 rounded-full bg-white object-cover`} />
}
