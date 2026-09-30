import { Header } from '../components/layout/Header'
import { CompetitivePriceSection } from '../components/competitive/CompetitivePriceSection'

export function Market() {
  return (
    <>
      <Header title="Market Comparison" subtitle="Compare prices on Blinkit and Zepto." />
      <main className="flex-1 px-5 pb-10 pt-5 sm:px-8">
        <CompetitivePriceSection />
      </main>
    </>
  )
}
