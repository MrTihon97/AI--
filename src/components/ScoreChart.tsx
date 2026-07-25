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

type ChartPoint = { date: string; score: number; iso: string }

type ChartTooltipProps = {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{ value?: unknown }>
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value
  const display =
    typeof value === 'number'
      ? value.toFixed(1)
      : typeof value === 'string'
        ? value
        : '—'
  return (
    <div className="rounded-xl border border-blue-100 bg-white px-3 py-2 shadow-[0_12px_32px_rgba(37,99,235,0.18)]">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="font-display text-sm font-semibold text-slate-900">
        Балл:{' '}
        <span className="tabular-nums text-brand-dark">{display} / 10</span>
      </p>
    </div>
  )
}

/** Сортировка сессий: дата, затем id (h-<timestamp>). */
function sessionTs(item: RoleplayHistoryItem): number {
  const fromId = Number(String(item.id).replace(/^h-/, ''))
  if (Number.isFinite(fromId) && fromId > 0) return fromId
  return Date.parse(item.date) || 0
}

function pointLabel(item: RoleplayHistoryItem, sameDayCount: number): string {
  const day = formatDate(item.date)
  if (sameDayCount <= 1) return day
  const ts = sessionTs(item)
  if (!ts) return day
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${day} ${hh}:${mm}`
}

/** Точка на каждую ролёвку (не схлопывать день) — иначе 3 сессии в один день = 1 точка без линии. */
function buildChartData(history: RoleplayHistoryItem[]): ChartPoint[] {
  const sorted = [...history].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date)
    if (byDate !== 0) return byDate
    return sessionTs(a) - sessionTs(b)
  })
  const recent = sorted.slice(-12)
  const dayCounts = new Map<string, number>()
  for (const item of recent) {
    dayCounts.set(item.date, (dayCounts.get(item.date) ?? 0) + 1)
  }
  return recent.map((item) => ({
    iso: item.date,
    date: pointLabel(item, dayCounts.get(item.date) ?? 1),
    score: Number(item.totalScore.toFixed(1)),
  }))
}

export function ScoreChart({ history }: Props) {
  const data = buildChartData(history)

  const avg =
    data.length > 0
      ? (data.reduce((sum, d) => sum + d.score, 0) / data.length).toFixed(1)
      : '—'

  const delta =
    data.length >= 2
      ? Number((data[data.length - 1]!.score - data[0]!.score).toFixed(1))
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
        {last ? (
          <div className="pointer-events-none absolute right-2 top-2 z-10 hidden rounded-xl bg-brand px-2.5 py-1 text-xs font-bold text-white shadow-[0_8px_20px_rgba(59,130,246,0.35)] sm:block">
            {last.score}
          </div>
        ) : null}

        {data.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-slate-50 to-blue-50/60 px-6 text-center ring-1 ring-slate-100">
            <p className="font-display text-sm font-semibold text-slate-800">
              График появится после первой ролёвки
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
              Сделайте первую ролёвку для получения аналитики и динамики баллов
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 12, right: 12, left: -18, bottom: 0 }}
            >
              <defs>
                <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="4 4"
                stroke="#e8eef7"
                vertical={false}
              />
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
                content={ChartTooltip}
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
