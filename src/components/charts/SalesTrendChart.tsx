import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SalesTrendPoint } from '../../lib/calculations'
import { formatCurrency, formatDate } from '../../lib/format'

export function SalesTrendChart({ data }: { data: SalesTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f172a" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#0f172a" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(value: string) => formatDate(value).slice(0, 6)}
          tick={{ fontSize: 12, fill: '#64748b' }}
          axisLine={{ stroke: '#e2e8f0' }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(value: number) => `₹${value / 1000}k`}
          tick={{ fontSize: 12, fill: '#64748b' }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          formatter={(value) => formatCurrency(Number(value))}
          labelFormatter={(label) => formatDate(String(label))}
          contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 13 }}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="#0f172a"
          strokeWidth={2}
          fill="url(#salesFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
