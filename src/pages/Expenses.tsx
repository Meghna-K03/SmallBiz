import { Header } from '../components/layout/Header'
import { DataGate } from '../components/ui/DataGate'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ExpenseForm } from '../components/expenses/ExpenseForm'
import { useData } from '../context/DataContext'
import { formatCurrency, formatDate } from '../lib/format'

export function Expenses() {
  const { expenses, addExpense } = useData()
  const sortedExpenses = [...expenses].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <Header title="Expenses" />
      <main className="flex-1 space-y-6 p-5">
        <DataGate>
        <Card title="Record Expense">
          <ExpenseForm onSubmit={addExpense} />
        </Card>

        <Card title="Expense History">
          {sortedExpenses.length === 0 ? (
            <EmptyState message="No expenses recorded yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4">Category</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-0">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedExpenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className="py-3 pr-4 font-medium text-slate-800">{expense.category}</td>
                      <td className="py-3 pr-4 text-slate-600">{formatCurrency(expense.amount)}</td>
                      <td className="py-3 pr-4 text-slate-600">{formatDate(expense.date)}</td>
                      <td className="py-3 pr-0 text-slate-600">{expense.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </DataGate>
      </main>
    </>
  )
}
