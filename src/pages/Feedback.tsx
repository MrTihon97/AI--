import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import confetti from 'canvas-confetti'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Lightbulb,
  Loader2,
  Quote,
  Trophy,
} from 'lucide-react'
import { saveRoleplayResult } from '../services/api'
import type { ChatMessage, FeedbackMistake, FeedbackSession } from '../types'
import {
  getZone,
  zoneBadgeClass,
  zoneBarClass,
  zoneResultLabel,
} from '../utils/zones'

const FEEDBACK_STORAGE_KEY = 'ai-trenazher-last-feedback'

const STAGE_NAMES: Record<string, string> = {
  contact: 'Установление контакта',
  discovery: 'Выявление потребностей',
  presentation: 'Презентация',
  objections: 'Работа с возражениями',
  closing: 'Завершение сделки',
}

const MISTAKE_LEAD: Record<string, string> = {
  contact: 'Слабый вход в контакт. Ваша реплика:',
  discovery: 'Вы ушли от выявления потребностей на фразе:',
  presentation: 'Презентация без привязки к боли. Вы сказали:',
  objections: 'Возражение обработано слабо. Ваш ответ:',
  closing: 'Закрытие без следующего шага. Вы сказали:',
}

type LocationState = FeedbackSession & {
  messages?: ChatMessage[]
  fromHistory?: boolean
  persisted?: boolean
}

function isFeedbackState(value: unknown): value is LocationState {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.clientId === 'string' &&
    typeof v.clientName === 'string' &&
    typeof v.feedback === 'object' &&
    v.feedback != null
  )
}

function readStoredSession(): LocationState | null {
  try {
    const raw = sessionStorage.getItem(FEEDBACK_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isFeedbackState(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeStoredSession(session: LocationState): void {
  sessionStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(session))
}

function sessionFingerprint(session: LocationState): string {
  const quotes = (session.managerMessages ?? [])
    .join('|')
    .slice(0, 120)
  return `${session.clientId}:${session.feedback.totalScore}:${quotes}`
}

const inFlightSaves = new Set<string>()

function fireSalute() {
  const defaults = {
    startVelocity: 48,
    spread: 360,
    ticks: 90,
    zIndex: 1000,
    colors: ['#2563eb', '#38bdf8', '#93c5fd', '#e0f2fe', '#ffffff', '#fbbf24'],
  }

  confetti({
    ...defaults,
    particleCount: 90,
    origin: { x: 0.5, y: 0.32 },
  })

  window.setTimeout(() => {
    confetti({
      ...defaults,
      particleCount: 45,
      origin: { x: 0.18, y: 0.55 },
    })
    confetti({
      ...defaults,
      particleCount: 45,
      origin: { x: 0.82, y: 0.55 },
    })
  }, 220)
}

function withLeads(
  mistakes: FeedbackMistake[],
): Array<FeedbackMistake & { lead: string }> {
  return mistakes.map((mistake) => ({
    ...mistake,
    managerQuote: mistake.managerQuote?.trim() || '—',
    lead: MISTAKE_LEAD[mistake.stageId] ?? 'Ваша реплика в диалоге:',
  }))
}

export function Feedback() {
  const location = useLocation()
  const navigate = useNavigate()

  const session = useMemo(() => {
    if (isFeedbackState(location.state)) return location.state
    return readStoredSession()
  }, [location.state])

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(() => !session?.fromHistory)

  const sessionKey = location.key || 'stored'
  const saluteFlagKey = `ai-trenazher-salute:${sessionKey}`

  const stageMap = useMemo(() => new Map(Object.entries(STAGE_NAMES)), [])

  const managerQuotes = useMemo(() => {
    if (!session) return [] as string[]
    if (session.managerMessages?.length) return session.managerMessages
    return (
      session.messages
        ?.filter((m) => m.role === 'manager')
        .map((m) => m.text) ?? []
    )
  }, [session])

  const enrichedMistakes = useMemo(() => {
    if (!session) return []
    return withLeads(session.feedback.mistakes)
  }, [session])

  useEffect(() => {
    if (isFeedbackState(location.state)) {
      writeStoredSession(location.state)
    }
  }, [location.state])

  useEffect(() => {
    if (session?.fromHistory) {
      setAnalyzing(false)
      return
    }
    const t = window.setTimeout(() => setAnalyzing(false), 800)
    return () => window.clearTimeout(t)
  }, [sessionKey, session?.fromHistory])

  useEffect(() => {
    if (analyzing || !session || session.fromHistory) return
    if (session.feedback.totalScore < 6) return
    if (sessionStorage.getItem(saluteFlagKey)) return
    sessionStorage.setItem(saluteFlagKey, '1')
    fireSalute()
  }, [analyzing, session, saluteFlagKey])

  useEffect(() => {
    if (!session || session.fromHistory || session.persisted) {
      if (session?.persisted) setSaved(true)
      return
    }

    const fp = sessionFingerprint(session)
    const doneKey = `ai-trenazher-saved:${fp}`
    if (sessionStorage.getItem(doneKey) || inFlightSaves.has(fp)) {
      setSaved(Boolean(sessionStorage.getItem(doneKey)))
      return
    }

    inFlightSaves.add(fp)
    setSaving(true)
    setSaveError(null)

    const stageScores = Object.fromEntries(
      session.feedback.stageScores.map((s) => [s.stageId, s.score]),
    )

    void saveRoleplayResult({
      clientId: session.clientId,
      clientName: session.clientName,
      totalScore: session.feedback.totalScore,
      stageScores,
      managerMessages: managerQuotes,
      feedback: session.feedback,
      insights: session.insights,
    })
      .then(() => {
        sessionStorage.setItem(doneKey, '1')
        writeStoredSession({ ...session, persisted: true })
        setSaved(true)
        setSaving(false)
      })
      .catch((e) => {
        inFlightSaves.delete(fp)
        setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения')
        setSaving(false)
      })
  }, [session, managerQuotes])

  if (!session) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <AlertCircle className="h-6 w-6" />
        </div>
        <p className="font-display font-semibold text-slate-900">
          Нет данных разбора
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Сначала пройдите ролёвку — разбор появится автоматически.
        </p>
        <Link
          to="/roleplay"
          className="btn-glow mt-5 rounded-full px-5 py-2.5 text-sm font-semibold"
        >
          К выбору клиента
        </Link>
      </div>
    )
  }

  const { feedback, clientName } = session
  const fromHistory = Boolean(session.fromHistory)
  const totalZone = getZone(feedback.totalScore)
  const recommendations = feedback.recommendations.slice(0, 3)

  const goHome = () => {
    navigate('/', { replace: true })
  }

  const retrySave = async () => {
    if (fromHistory || saving) return
    const fp = sessionFingerprint(session)
    const doneKey = `ai-trenazher-saved:${fp}`
    inFlightSaves.add(fp)
    setSaving(true)
    setSaveError(null)
    try {
      const stageScores = Object.fromEntries(
        feedback.stageScores.map((s) => [s.stageId, s.score]),
      )
      await saveRoleplayResult({
        clientId: session.clientId,
        clientName,
        totalScore: feedback.totalScore,
        stageScores,
        managerMessages: managerQuotes,
        feedback,
        insights: session.insights,
      })
      sessionStorage.setItem(doneKey, '1')
      writeStoredSession({ ...session, persisted: true })
      setSaved(true)
    } catch (e) {
      inFlightSaves.delete(fp)
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  if (analyzing) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-blue-400/30" />
          <Loader2 className="relative h-10 w-10 animate-spin text-brand" />
        </div>
        <p className="font-display mt-4 text-base font-semibold text-slate-900">
          ИИ анализирует диалог…
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Сверяем ваши реплики с эталоном по 5 этапам продаж
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 pb-10">
      <button
        type="button"
        onClick={goHome}
        className="animate-fade-in inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand"
      >
        <ArrowLeft className="h-4 w-4" />
        На главную
      </button>

      <header className="soft-card animate-fade-up relative overflow-hidden rounded-[22px] p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-blue-400/15 blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <p className="flex items-center gap-2 text-sm font-medium text-brand">
            <Trophy className="h-4 w-4" />
            {fromHistory ? 'Разбор из истории' : 'Разбор ролёвки'}
          </p>
          <h1 className="font-display mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Диалог с {clientName}
          </h1>

          <div className="mt-6 flex flex-wrap items-end gap-4">
            <p className="font-display text-6xl font-black tabular-nums tracking-tight text-brand sm:text-7xl">
              {feedback.totalScore.toFixed(1)}
              <span className="text-2xl font-semibold text-slate-300 sm:text-3xl">
                {' '}
                / 10
              </span>
            </p>
            <span
              className={`mb-2 rounded-full px-3 py-1 text-xs font-bold tracking-wide ring-1 ${zoneBadgeClass(totalZone)}`}
            >
              {zoneResultLabel(totalZone)}
            </span>
          </div>

          {!fromHistory && (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                  Сохраняем прогресс…
                </>
              ) : saveError ? (
                <span className="text-rose-600">{saveError}</span>
              ) : saved ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  Прогресс сохранён · стрик и история обновлены
                </>
              ) : null}
            </p>
          )}

          {session.insights && session.insights.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {session.insights.map((insight) => (
                <li
                  key={insight.id}
                  className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-blue-100"
                >
                  {insight.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <section className="soft-card animate-fade-up stagger-2 rounded-[22px] p-5 sm:p-6">
        <h2 className="font-display mb-5 text-base font-semibold text-slate-900">
          Оценки по 5 этапам продаж
        </h2>
        <ul className="space-y-5">
          {feedback.stageScores.map((item) => {
            const zone = getZone(item.score)
            const pct = (item.score / 10) * 100
            return (
              <li key={item.stageId}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">
                    {stageMap.get(item.stageId) ?? item.stageId}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums ring-1 ${zoneBadgeClass(zone)}`}
                  >
                    {item.score}
                    <span className="font-medium opacity-60"> / 10</span>
                  </span>
                </div>
                <div className="mb-2 h-2.5 overflow-hidden rounded-full bg-slate-100/90">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${zoneBarClass(zone)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-sm leading-relaxed text-slate-600">
                  {item.comment}
                </p>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="soft-card animate-fade-up stagger-3 rounded-[22px] p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Разбор ошибок
            </h2>
            <p className="text-xs text-slate-500">Цитаты из ваших реплик в чате</p>
          </div>
        </div>

        {enrichedMistakes.length === 0 ? (
          <p className="text-sm text-slate-500">Критических ошибок не найдено.</p>
        ) : (
          <ul className="space-y-4">
            {enrichedMistakes.map((mistake, i) => (
              <li
                key={`${mistake.stageId}-${i}`}
                className="rounded-2xl border border-rose-100/80 bg-gradient-to-br from-rose-50/90 to-white/90 p-4"
              >
                <p className="text-xs font-bold uppercase tracking-wide text-rose-500">
                  {stageMap.get(mistake.stageId) ?? mistake.stageId}
                </p>
                <p className="mt-2 text-sm text-slate-600">{mistake.lead}</p>
                <blockquote className="mt-2 flex gap-2 rounded-xl bg-white/90 px-3 py-3 text-sm font-medium italic text-slate-800 ring-1 ring-rose-100">
                  <Quote className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                  <span>«{mistake.managerQuote}»</span>
                </blockquote>
                <p className="mt-3 text-sm leading-relaxed text-rose-600/90">
                  {mistake.comment}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="soft-card animate-fade-up stagger-4 rounded-[22px] p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
            <Lightbulb className="h-4 w-4" />
          </div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Рекомендации от ИИ
          </h2>
        </div>
        <ul className="space-y-3">
          {recommendations.map((rec, index) => (
            <li
              key={rec}
              className="flex gap-3 rounded-xl bg-blue-50/60 px-3 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-blue-100/70"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-bold text-white">
                {index + 1}
              </span>
              <span>{rec}</span>
            </li>
          ))}
        </ul>
      </section>

      {saveError ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => void retrySave()}
          className="btn-glow animate-fade-up stagger-5 flex w-full items-center justify-center gap-2 rounded-full py-4 text-sm font-bold disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Повторить сохранение
        </button>
      ) : (
        <button
          type="button"
          onClick={goHome}
          className="btn-glow animate-fade-up stagger-5 flex w-full items-center justify-center gap-2 rounded-full py-4 text-sm font-bold"
        >
          На главную
        </button>
      )}
    </div>
  )
}
