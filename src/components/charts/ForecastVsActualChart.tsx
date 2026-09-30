import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDate } from '../../lib/format'
import type { TestWindowPoint } from '../../types/analytics'

/**
 * What really sold vs what the selected model predicted, on the most recent days that were
 * held out from training. Both series come from the backend; nothing is calculated here.
 */
export function ForecastVsActualChart({ data }: { data: TestWindowPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(value: string) => formatDate(value).slice(0, 6)}
          tick={{ fontSize: 11, fill: '#64748b' }}
          axisLine={{ stroke: '#e2e8f0' }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={32} allowDecimals={false} tickFormatter={(v: number) => String(Math.round(v))} />
        <Tooltip
          formatter={(value) => (typeof value === 'number' ? Math.round(value) : value)}
          labelFormatter={(label) => formatDate(String(label))}
          contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="actual" name="Actual sold" stroke="#0f172a" strokeWidth={2} dot={{ r: 2 }} />
        <Line type="monotone" dataKey="predicted" name="Forecast" stroke="#4f46e5" strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
