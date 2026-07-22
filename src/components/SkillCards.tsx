import { useEffect, useState } from 'react'
import {
  Handshake,
  MessageCircleQuestion,
  Presentation,
  ShieldAlert,
  Target,
  X,
} from 'lucide-react'
import type { StageProgress, Zone } from '../types'
import {
  getZone,
  zoneBadgeClass,
  zoneBarClass,
  zoneShortLabel,
  zoneTextClass,
} from '../utils/zones'

interface Props {
  stages: StageProgress[]
}

const STAGE_ICONS: Record<string, typeof Target> = {
  contact: Handshake,
  discovery: MessageCircleQuestion,
  presentation: Presentation,
  objections: ShieldAlert,
  closing: Target,
}

const ICON_WRAP: Record<string, string> = {
  red: 'bg-rose-50 text-rose-500 ring-rose-100',
  yellow: 'bg-amber-50 text-amber-500 ring-amber-100',
  green: 'bg-emerald-50 text-emerald-500 ring-emerald-100',
}

const STAGE_TIPS: Record<string, string> = {
  contact:
    'Начните с приветствия и проверки удобства разговора. Не прыгайте сразу в продукт.',
  discovery:
    'Задайте 3+ вопроса о потерях заявок, администраторе и повторных визитах до презентации.',
  presentation:
    'Говорите выгодами под боль клиента, а не списком функций CRM.',
  objections:
    'На «дорого» сначала посчитайте потери клиники в деньгах, потом цену подписки.',
  closing:
    'Зафиксируйте next step: демо, дата, WhatsApp. «Подумайте» без слота — проигрыш.',
}

export function SkillCards({ stages }: Props) {
  const [selected, setSelected] = useState<StageProgress | null>(null)
  const selectedZone = selected ? getZone(selected.score) : null

  return (
    <section className="animate-fade-up stagger-1">
      <div className="mb-3">
        <h2 className="font-display text-base font-semibold text-slate-900">
          Этапы продаж
        </h2>
        <p className="text-xs text-slate-500">
          Нажмите карточку — подсказка по этапу
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stages.map((stage, i) => {
          const zone = getZone(stage.score)
          const pct = Math.min(100, (stage.score / 10) * 100)
          const Icon = STAGE_ICONS[stage.id] ?? Target

          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => setSelected(stage)}
              className={`soft-card animate-fade-up rounded-[22px] p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)] hover:ring-2 hover:ring-blue-100 stagger-${Math.min(i + 1, 5)}`}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ring-1 ${ICON_WRAP[zone]}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ring-1 ${zoneBadgeClass(zone)}`}
                >
                  {zoneShortLabel(zone)}
                </span>
              </div>

              <h3 className="mb-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-slate-800">
                {stage.name}
              </h3>

              <p
                className={`font-display text-[1.65rem] font-bold leading-none tabular-nums ${zoneTextClass(zone)}`}
              >
                {stage.score.toFixed(1)}
                <span className="text-sm font-semibold text-slate-300"> / 10</span>
              </p>

              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${zoneBarClass(zone)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          )
        })}
      </div>

      {selected && selectedZone && (
        <SkillTipModal
          stage={selected}
          zone={selectedZone}
          tip={
            STAGE_TIPS[selected.id] ??
            'Тренируйте этот этап в следующей ролёвке.'
          }
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}

function SkillTipModal({
  stage,
  zone,
  tip,
  onClose,
}: {
  stage: StageProgress
  zone: Zone
  tip: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 p-4 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="soft-card w-full max-w-md rounded-[22px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">
              Подсказка этапа
            </p>
            <h3 className="font-display mt-1 text-lg font-bold text-slate-900">
              {stage.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p
          className={`font-display text-3xl font-bold tabular-nums ${zoneTextClass(zone)}`}
        >
          {stage.score.toFixed(1)}
          <span className="text-base text-slate-300"> / 10</span>
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{tip}</p>
        <button
          type="button"
          onClick={onClose}
          className="btn-glow mt-5 w-full rounded-full py-2.5 text-sm font-bold"
        >
          Понятно
        </button>
      </div>
    </div>
  )
}
