import { Link } from 'react-router-dom'
import { ChevronRight, Play, Sparkles, Star } from 'lucide-react'
import type { RoleplayHistoryItem } from '../types'
import {
  formatDate,
  getZone,
  zoneBadgeClass,
  zoneShortLabel,
  zoneTextClass,
} from '../utils/zones'
import { initials } from '../utils/initials'

interface Props {
  history: RoleplayHistoryItem[]
  onOpen: (item: RoleplayHistoryItem) => void
}

const AVATAR_COLORS = [
  'from-violet-400 to-violet-600',
  'from-emerald-400 to-teal-600',
  'from-sky-400 to-blue-600',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-pink-600',
]

export function RoleplayHistoryList({ history, onOpen }: Props) {
  return (
    <section className="soft-card flex h-full flex-col rounded-[22px] p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="font-display text-base font-semibold text-slate-900">
          История ролёвок
        </h2>
        <p className="text-xs text-slate-500">
          {history.length === 0
            ? 'Здесь появится динамика ваших тренировок'
            : 'Нажмите запись, чтобы открыть разбор'}
        </p>
      </div>

      {history.length === 0 ? (
        <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl bg-gradient-to-br from-blue-50 via-sky-50 to-white p-5 ring-1 ring-blue-100">
          <div
            className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-blue-400/20 blur-2xl"
            aria-hidden
          />
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-brand shadow-[0_8px_20px_rgba(59,130,246,0.25)] ring-1 ring-blue-100">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="font-display relative mt-4 text-base font-bold tracking-tight text-slate-900">
            Сделайте первую ролёвку для получения аналитики
          </p>
          <p className="relative mt-2 text-sm leading-relaxed text-slate-600">
            После диалога здесь появятся оценки, график динамики и разборы с
            вашими цитатами.
          </p>
          <Link
            to="/roleplay"
            className="btn-glow relative mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-bold sm:w-auto"
          >
            <Play className="h-4 w-4 fill-white" />
            Начать первую ролёвку
          </Link>
        </div>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {history.map((item, index) => {
            const zone = getZone(item.totalScore)
            const color = AVATAR_COLORS[index % AVATAR_COLORS.length]
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-slate-50/80 px-3 py-2.5 text-left ring-1 ring-slate-100 transition hover:bg-white hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] hover:ring-blue-100"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-bold text-white ${color}`}
                    >
                      {initials(item.clientName)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {item.clientName}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {formatDate(item.date)} · открыть разбор
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`inline-flex items-center gap-1 text-sm font-bold tabular-nums ${zoneTextClass(zone)}`}
                      >
                        <Star className="h-3.5 w-3.5 fill-current" />
                        {item.totalScore.toFixed(1)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ring-1 ${zoneBadgeClass(zone)}`}
                      >
                        {zoneShortLabel(zone)}
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
