import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  Home,
  MessageSquare,
  Menu,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react'

const LINKS = [
  { to: '/', label: 'Дашборд', icon: Home, end: true },
  { to: '/roleplay', label: 'Ролёвка', icon: MessageSquare, end: false },
] as const

interface Props {
  /** Показать пункт «Сбросить прогресс» (только на дашборде). */
  onResetProgress?: () => void
  /** Скрыть оболочку (полноэкранный чат). */
  hidden?: boolean
}

export function AppNav({ onResetProgress, hidden }: Props) {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (hidden) return null

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-blue-100/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-[0_6px_14px_rgba(59,130,246,0.35)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-display truncate text-sm font-bold tracking-tight text-slate-900">
              ДентаCRM · AI
            </span>
          </Link>

          {/* Desktop: Дашборд | Ролёвка (без дубля «Тренировка») */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Основная">
            {LINKS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                    isActive
                      ? 'bg-blue-50 text-brand ring-1 ring-blue-100'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 md:hidden"
            aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-50 md:hidden ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}
        aria-hidden={!open}
      >
        <button
          type="button"
          className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label="Закрыть меню"
          onClick={() => setOpen(false)}
        />

        <aside
          className={`absolute right-0 top-0 flex h-[100dvh] w-[min(20rem,88vw)] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Мобильное меню"
        >
          <div className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
            <p className="font-display text-sm font-bold text-slate-900">Меню</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Мобильная">
            {LINKS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition ${
                    isActive
                      ? 'bg-blue-50 text-brand ring-1 ring-blue-100'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`
                }
              >
                <Icon className="h-5 w-5" />
                {label}
              </NavLink>
            ))}

            {onResetProgress ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onResetProgress()
                }}
                className="mt-auto flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <RotateCcw className="h-5 w-5" />
                Сбросить прогресс
              </button>
            ) : null}
          </nav>

          <p className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-400">
            AI-тренажёр продаж · демо без бэкенда
          </p>
        </aside>
      </div>
    </>
  )
}
