import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import confetti from 'canvas-confetti'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Home,
  Loader2,
  Quote,
  RefreshCw,
  Target,
  XCircle,
} from 'lucide-react'
import { saveRoleplayResult } from '../services/api'
import type {
  ChatMessage,
  FeedbackMistake,
  FeedbackSession,
  FeedbackSuccess,
  Zone,
} from '../types'
import { FeedbackSkeleton } from '../components/Skeleton'
import { AppNav } from '../components/AppNav'
import { STAGE_LABELS } from '../services/feedbackEngine'
import { defaultBetterScriptForStage } from '../utils/reportValidator'

const FEEDBACK_STORAGE_KEY = 'ai-trenazher-last-feedback'

const STAGE_NAMES: Record<string, string> = {
  contact: STAGE_LABELS.contact,
  discovery: STAGE_LABELS.discovery,
  presentation: STAGE_LABELS.presentation,
  objections: STAGE_LABELS.objections,
  closing: STAGE_LABELS.closing,
}

type LocationState = FeedbackSession & {
  messages?: ChatMessage[]
  fromHistory?: boolean
  persisted?: boolean
  /** Уникальный id завершения — чтобы не схлопнуть две похожие ролёвки */
  sessionId?: string
}

type QuoteRow =
  | { kind: 'error'; item: FeedbackMistake; index: number }
  | { kind: 'success'; item: FeedbackSuccess; index: number }

/** Светофор отчёта: 1–4 красный, 5–7 жёлтый, 8–10 зелёный */
function getReportZone(score: number): Zone {
  if (score <= 4) return 'red'
  if (score <= 7) return 'yellow'
  return 'green'
}

function reportBarClass(zone: Zone): string {
  switch (zone) {
    case 'red':
      return 'bg-rose-500'
    case 'yellow':
      return 'bg-amber-400'
    case 'green':
      return 'bg-emerald-500'
  }
}

function reportBadgeClass(zone: Zone): string {
  switch (zone) {
    case 'red':
      return 'bg-rose-50 text-rose-700 ring-rose-200'
    case 'yellow':
      return 'bg-amber-50 text-amber-700 ring-amber-200'
    case 'green':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  }
}

function reportCardRing(zone: Zone): string {
  switch (zone) {
    case 'red':
      return 'ring-rose-200/80'
    case 'yellow':
      return 'ring-amber-200/80'
    case 'green':
      return 'ring-emerald-200/80'
  }
}

function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return '—'
  const m = t.match(/^(.+?[.!?…])(\s|$)/)
  return m?.[1] ?? t
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
  // sessionId — главный ключ (каждая завершённая ролёвка уникальна)
  if (session.sessionId) return `sid:${session.sessionId}`
  const msgs = session.managerMessages ?? []
  const quotes = msgs.join('|')
  // Legacy fallback: клиент + балл + длина + хвост цитат (не только первые 120)
  const tail = quotes.slice(-80)
  return `${session.clientId}:${session.feedback.totalScore}:${msgs.length}:${quotes.length}:${tail}`
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

  const quoteRows = useMemo((): QuoteRow[] => {
    if (!session) return []
    const errors: QuoteRow[] = session.feedback.mistakes.map((item, index) => ({
      kind: 'error',
      item,
      index,
    }))
    const wins: QuoteRow[] = (session.feedback.successes ?? []).map(
      (item, index) => ({ kind: 'success', item, index }),
    )
    return [...errors, ...wins]
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
    // Салют только при успешном зачёте (≥7 / verdict=passed).
    // Пересдача, этика, оффтоп — без confetti и без похвалы.
    const passed =
      session.feedback.verdict === 'passed' ||
      (session.feedback.verdict == null &&
        session.feedback.totalScore >= 7 &&
        !session.feedback.etiquetteViolation &&
        !session.feedback.offTopicViolation &&
        session.feedback.failReason == null)
    if (!passed) return
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
      <>
        <AppNav />
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <AlertCircle className="h-6 w-6" />
          </div>
          <p className="font-display font-semibold text-slate-900">
            Нет данных разбора
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Сначала пройдите ролёвку — отчёт появится автоматически.
          </p>
          <Link
            to="/roleplay"
            className="btn-glow mt-5 rounded-full px-5 py-2.5 text-sm font-semibold"
          >
            К выбору клиента
          </Link>
        </div>
      </>
    )
  }

  const { feedback, clientName } = session
  const fromHistory = Boolean(session.fromHistory)
  const verdict =
    feedback.verdict ?? (feedback.totalScore >= 7 ? 'passed' : 'retake')
  const verdictLabel =
    feedback.verdictLabel ??
    (verdict === 'passed' ? 'Пройдено' : 'Требуется пересдача')
  const toxicityFail =
    feedback.failReason === 'toxicity_limit_exceeded' ||
    feedback.failReason === 'terminated_etiquette' ||
    feedback.failReason === 'terminated_offtopic' ||
    feedback.etiquetteViolation === true ||
    feedback.offTopicViolation === true
  const growthPoints = [
    feedback.mainRecommendation,
    ...feedback.recommendations.filter((r) => r !== feedback.mainRecommendation),
  ]
    .filter(Boolean)
    .slice(0, 3) as string[]

  const goHome = () => {
    navigate('/', { replace: true })
  }

  const retryRoleplay = () => {
    navigate('/roleplay')
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
      <>
        <AppNav />
        <div>
          <div className="mx-auto max-w-3xl px-4 pt-6">
            <p className="mb-4 text-center text-sm font-medium text-slate-500">
              Формируем квалификационный отчёт…
            </p>
          </div>
          <FeedbackSkeleton />
        </div>
      </>
    )
  }

  return (
    <>
      <AppNav />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 pb-12 md:py-8">
        {/* —— 1. Шапка отчёта —— */}
        <header className="soft-card animate-fade-up overflow-hidden rounded-[22px] border border-slate-200/80">
          <div
            className={`px-5 py-3 sm:px-6 ${
              verdict === 'passed'
                ? 'bg-emerald-600 text-white'
                : 'bg-rose-600 text-white'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-90">
                Отчёт о квалификации менеджера
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide backdrop-blur-sm">
                {verdict === 'passed' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {verdictLabel}
              </span>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <p className="text-xs font-medium text-slate-500">
              {fromHistory ? 'Архивный разбор' : 'Сессия только что завершена'} ·{' '}
              {clientName}
            </p>

            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Общий балл
                </p>
                <p className="font-display mt-1 text-5xl font-black tabular-nums tracking-tight text-slate-900 sm:text-6xl">
                  {feedback.totalScore.toFixed(1)}
                  <span className="text-2xl font-semibold text-slate-300">
                    {' '}
                    / 10
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Порог зачёта: 7.0 · светофор этапов: 1–4 / 5–7 / 8–10
                </p>
              </div>

              <div
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black uppercase tracking-wide ring-2 ${
                  verdict === 'passed'
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-300'
                    : 'bg-rose-50 text-rose-700 ring-rose-300'
                }`}
              >
                {verdict === 'passed' ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
                {verdict === 'passed' ? 'Пройдено' : verdictLabel}
              </div>
            </div>

            {toxicityFail ? (
              <div
                className="mt-5 flex gap-3 rounded-2xl bg-rose-50 px-4 py-3.5 ring-2 ring-rose-300"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                <div>
                  <p className="text-sm font-bold text-rose-900">
                    КРИТИЧЕСКАЯ ОШИБКА • Деловая этика
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-rose-800">
                    Использование ненормативной лексики и оскорблений (2+
                    нарушения). Сессия прервана автоматически. Итоговый балл —{' '}
                    {feedback.totalScore.toFixed(1)} / 10. Статус:{' '}
                    {verdictLabel || 'ТРЕБУЕТСЯ ПЕРЕСДАЧА'}.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={retryRoleplay}
                className="btn-glow inline-flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold"
              >
                <RefreshCw className="h-4 w-4" />
                Пройти повторно
              </button>
              <button
                type="button"
                onClick={goHome}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                <Home className="h-4 w-4" />
                Вернуться на Дашборд
              </button>
            </div>

            {!fromHistory && (
              <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                    Сохраняем в историю…
                  </>
                ) : saveError ? (
                  <button
                    type="button"
                    onClick={() => void retrySave()}
                    className="font-medium text-rose-600 underline-offset-2 hover:underline"
                  >
                    {saveError} · повторить сохранение
                  </button>
                ) : saved ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    Зафиксировано в прогрессе
                  </>
                ) : null}
              </p>
            )}
          </div>
        </header>

        {/* —— 2. Светофор этапов —— */}
        <section className="animate-fade-up stagger-1">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              Этапы продаж
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {feedback.stageScores.map((item) => {
              const zone = getReportZone(item.score)
              const pct = Math.min(100, (item.score / 10) * 100)
              return (
                <article
                  key={item.stageId}
                  className={`soft-card rounded-[18px] p-4 ring-1 ${reportCardRing(zone)}`}
                >
                  <div className="mb-2.5 flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold leading-snug text-slate-800">
                      {stageMap.get(item.stageId) ?? item.stageId}
                    </h3>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ring-1 ${reportBadgeClass(zone)}`}
                    >
                      {item.score.toFixed(1)}
                    </span>
                  </div>
                  <div className="mb-2.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${reportBarClass(zone)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600">
                    {firstSentence(item.comment)}
                  </p>
                </article>
              )
            })}
          </div>
        </section>

        {/* —— 3. Разбор реальных цитат —— */}
        <section className="soft-card animate-fade-up stagger-2 rounded-[22px] p-5 sm:p-6">
          <div className="mb-1 flex items-center gap-2">
            <Quote className="h-4 w-4 text-slate-400" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              Разбор реальных цитат
            </h2>
          </div>
          <p className="mb-5 text-xs text-slate-500">
            Фактура из вашего чата — без шаблонных формулировок
          </p>

          {quoteRows.length === 0 ? (
            <p className="text-sm text-slate-500">Цитат для разбора нет.</p>
          ) : (
            <ul className="space-y-3">
              {quoteRows.map((row) =>
                row.kind === 'error' ? (
                  <li
                    key={`err-${row.index}`}
                    className={`overflow-hidden rounded-2xl border bg-white ${
                      row.item.tag === 'etiquette_violation' ||
                      row.item.tag === 'offtopic_violation' ||
                      /ненорматив|хамств|деловой этик|2\+\s*нарушен|off-topic|вне темы|предметн/i.test(
                        row.item.comment,
                      )
                        ? 'border-rose-300 ring-1 ring-rose-200'
                        : 'border-rose-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 border-b border-rose-100 bg-rose-50/80 px-3.5 py-2">
                      <span className="rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                        {row.item.tag === 'etiquette_violation' ||
                        row.item.tag === 'offtopic_violation' ||
                        /ненорматив|хамств|деловой этик|2\+\s*нарушен|off-topic|вне темы|предметн/i.test(
                          row.item.comment,
                        )
                          ? 'Крит. ошибка'
                          : 'Ошибка'}
                      </span>
                      <span className="text-[11px] font-semibold text-rose-700/80">
                        {row.item.tag === 'etiquette_violation' ||
                        /ненорматив|хамств|деловой этик|2\+\s*нарушен/i.test(
                          row.item.comment,
                        )
                          ? 'КРИТИЧЕСКАЯ ОШИБКА • Деловая этика'
                          : row.item.tag === 'offtopic_violation' ||
                              /off-topic|вне темы|предметн/i.test(
                                row.item.comment,
                              )
                            ? 'КРИТИЧЕСКАЯ ОШИБКА • Вне темы'
                            : (stageMap.get(row.item.stageId) ?? row.item.stageId)}
                      </span>
                    </div>
                    <div className="space-y-3 px-3.5 py-3.5">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Цитата
                        </p>
                        <p className="mt-1 text-sm font-medium italic text-slate-900">
                          «{row.item.managerQuote?.trim() || '—'}»
                        </p>
                      </div>
                      {row.item.tag === 'etiquette_violation' ||
                      row.item.tag === 'offtopic_violation' ||
                      /ненорматив|хамств|деловой этик|2\+\s*нарушен|off-topic|вне темы|предметн/i.test(
                        row.item.comment,
                      ) ? (
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-rose-500">
                              Почему плохо
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-slate-700">
                              {row.item.comment ||
                                'Использование ненормативной лексики и оскорблений (2+ нарушения). Сессия прервана автоматически.'}
                            </p>
                          </div>
                          <div
                            className="hidden pt-5 text-slate-300 sm:block"
                            aria-hidden
                          >
                            ➔
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                              Как правильно
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-slate-800">
                              {row.item.betterScript?.trim() ||
                                'Сохраняйте профессиональный тон общения в любых ситуациях.'}
                            </p>
                          </div>
                        </div>
                      ) : !row.item.betterScript?.trim() ? (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-500">
                            Почему плохо
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-slate-700">
                            {row.item.comment}
                          </p>
                        </div>
                      ) : (
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-500">
                            Почему плохо
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-slate-700">
                            {row.item.comment}
                          </p>
                        </div>
                        <div
                          className="hidden pt-5 text-slate-300 sm:block"
                          aria-hidden
                        >
                          ➔
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                            Как сказать правильно
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-slate-800">
                            «
                            {row.item.betterScript?.trim() ||
                              defaultBetterScriptForStage(row.item.stageId)}
                            »
                          </p>
                        </div>
                      </div>
                      )}
                    </div>
                  </li>
                ) : (
                  <li
                    key={`ok-${row.index}`}
                    className={`overflow-hidden rounded-2xl border bg-white ${
                      row.item.tag === 'strong_argument'
                        ? 'border-amber-300 ring-1 ring-amber-200'
                        : 'border-emerald-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 border-b border-emerald-100 bg-emerald-50/80 px-3.5 py-2">
                      <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                        Успех
                      </span>
                      <span className="text-[11px] font-semibold text-emerald-700/80">
                        {stageMap.get(row.item.stageId) ?? row.item.stageId}
                      </span>
                      {row.item.tag === 'strong_argument' && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white shadow-sm">
                          ⚡ Сильная аргументация
                        </span>
                      )}
                    </div>
                    <div className="space-y-3 px-3.5 py-3.5">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Цитата
                        </p>
                        <p className="mt-1 text-sm font-medium italic text-slate-900">
                          «{row.item.managerQuote?.trim() || '—'}»
                        </p>
                      </div>
                      <div>
                        <p
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            row.item.tag === 'strong_argument'
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                          }`}
                        >
                          {row.item.tag === 'strong_argument'
                            ? 'Комментарий РОПа'
                            : 'Почему сработало'}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-slate-700">
                          {row.item.comment}
                        </p>
                      </div>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>

        {/* —— 4. Сухой вердикт РОПа —— */}
        <section className="animate-fade-up stagger-3 rounded-[22px] border-2 border-slate-800 bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-4 w-4 text-slate-800" />
            <h2 className="font-display text-base font-bold uppercase tracking-wide text-slate-900">
              Точки роста на следующую тренировку
            </h2>
          </div>
          <ul className="space-y-3">
            {growthPoints.map((point, i) => (
              <li
                key={point}
                className="flex gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0"
              >
                <span className="font-display mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-900 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-slate-800">{point}</p>
              </li>
            ))}
          </ul>
        </section>

        <button
          type="button"
          onClick={goHome}
          className="animate-fade-in mx-auto flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand"
        >
          <ArrowLeft className="h-4 w-4" />
          На дашборд
        </button>
      </div>
    </>
  )
}
