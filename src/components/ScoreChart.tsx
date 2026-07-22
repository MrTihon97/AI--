import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import type { RoleplayHistoryItem } from '../types'
import { formatDate } from '../utils/zones'

interface Props {
  history: RoleplayHistoryItem[]
}

export function ScoreChart({ history }: Props) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  const week = sorted.slice(-7)

  const data = week.map((item) => ({
    date: formatDate(item.date),
    score: Number(item.totalScore.toFixed(1)),
  }))

  const avg =
    data.length > 0
      ? (data.reduce((sum, d) => sum + d.score, 0) / data.length).toFixed(1)
      : '—'

  const delta =
    data.length >= 2
      ? Number((data[data.length - 1].score - data[0].score).toFixed(1))
      : 0

  const last = data[data.length - 1]

  return (
    <section className="soft-card animate-fade-up stagger-2 rounded-[22px] p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-brand ring-1 ring-blue-100">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Динамика общего балла
            </h2>
            <p className="text-xs text-slate-500">За последние тренировки</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-2.5 ring-1 ring-slate-100">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Средний балл
            </p>
            <p className="font-display text-lg font-bold tabular-nums text-slate-900">
              {avg}
            </p>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              За неделю
            </p>
            <p
              className={`font-display text-lg font-bold tabular-nums ${
                delta > 0
                  ? 'text-emerald-500'
                  : delta < 0
                    ? 'text-rose-500'
                    : 'text-slate-500'
              }`}
            >
              {delta > 0 ? '+' : ''}
              {delta}
            </p>
          </div>
        </div>
      </div>

      <div className="relative h-56 w-full sm:h-64">
        {last && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 hidden rounded-xl bg-brand px-2.5 py-1 text-xs font-bold text-white shadow-[0_8px_20px_rgba(59,130,246,0.35)] sm:block">
            {last.score}
          </div>
        )}
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Пока нет данных для графика
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="#e8eef7" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 10]}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #dbeafe',
                  boxShadow: '0 10px 30px rgba(59,130,246,0.12)',
                }}
                formatter={(value) => [`${value} / 10`, 'Балл']}
              />
              <Area
                type="monotone"
                dataKey="score"
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill="url(#scoreFill)"
                dot={{ r: 4, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}
