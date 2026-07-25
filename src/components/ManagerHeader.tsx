import { Link } from 'react-router-dom'
import { Flame, Play } from 'lucide-react'
import type { ManagerProfile, Product } from '../types'
import { initials } from '../utils/initials'

interface Props {
  manager: ManagerProfile
  product: Product
}

export function ManagerHeader({ manager, product }: Props) {
  return (
    <header className="animate-fade-up soft-card flex flex-col gap-4 rounded-[22px] px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between md:px-6 md:py-5">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="font-display flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-base font-bold text-white shadow-[0_8px_20px_rgba(59,130,246,0.35)] md:h-14 md:w-14 md:text-lg">
          {initials(product.name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-400">
            AI-тренажёр продаж
          </p>
          <h1 className="font-display truncate text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
            {product.name} · AI
          </h1>
          <p className="text-sm text-slate-500">
            Уровень {manager.level} · менеджер по продажам
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 md:gap-3">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3.5 py-2 text-sm font-semibold text-orange-600 ring-1 ring-orange-100">
          <Flame className="h-4 w-4 fill-orange-500 text-orange-500" />
          {manager.streakDays} дн. подряд
        </div>

        <Link
          to="/roleplay"
          className="btn-glow hidden items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold md:inline-flex"
        >
          <Play className="h-4 w-4 fill-white" />
          Начать новую ролёвку
        </Link>
      </div>
    </header>
  )
}
