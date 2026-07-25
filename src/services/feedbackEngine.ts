import type {
  FeedbackMistake,
  FeedbackResult,
  FeedbackStageScore,
  FeedbackSuccess,
} from '../types'
import { isDevelopedArgument } from './intentMatcher'
import {
  containsGreetingKeywords,
  containsLossCalcKeywords,
  containsNextStepKeywords,
  containsProfanity,
  normalizeQuoteKey,
  realignQuoteCards,
  sanitizeQuoteJustifications,
  validateAndClassifyQuote,
  whyWorkedForStage,
} from '../utils/reportValidator'
import {
  isClosingStage,
  isContactFrameQuote,
  isDiscoveryDiagnosticQuote,
  isPresentationStage,
  isQuestion,
} from '../utils/stageMatcher'
import {
  hasExplicitDateTimeSlot,
  isFuzzyNextStep,
} from '../dialogue/entities'
import {
  isFullReplacementPitch,
  isIntegrationPitch,
  mentionsLegacyCrm,
} from '../dialogue/intents'
import {
  evaluateValuePitch,
  isAbstractBenefitOnly,
} from '../dialogue/valueMetrics'

export type IntentLogItem = {
  intentId: string
  managerQuote: string
  /**
   * Этап разбора в момент отправки реплики
   * (contact / discovery / presentation / objections / closing).
   */
  stage?: StageId
  /** Сырой FSM stage (intro / discovery / …) */
  fsmStage?: string
  timestamp?: number
}

/** FSM SalesStage → bucket разбора */
export function salesStageToFeedbackStage(
  fsmStage?: string | null,
): StageId {
  switch (fsmStage) {
    case 'intro':
      return 'contact'
    case 'discovery':
      return 'discovery'
    case 'presentation':
      return 'presentation'
    case 'objection':
      return 'objections'
    case 'closing':
    case 'ended':
      return 'closing'
    default:
      return 'contact'
  }
}

/** Конструктивный placeholder — без чужих цитат с другого этапа */
export const STAGE_NO_QUOTE_PLACEHOLDER: Record<StageId, string> = {
  contact: 'На этапе контакта не зафиксировано реплик менеджера.',
  discovery:
    'На этапе выявления потребностей не зафиксировано реплик менеджера.',
  presentation: 'На этапе презентации не зафиксировано реплик менеджера.',
  objections: 'На этапе возражений не зафиксировано реплик менеджера.',
  closing: 'На этапе закрытия не зафиксировано реплик менеджера.',
}

export function isStagePlaceholder(quote: string): boolean {
  const t = quote.replace(/\s+/g, ' ').trim()
  return (
    t === '—' ||
    Object.values(STAGE_NO_QUOTE_PLACEHOLDER).some((p) => p === t) ||
    /^на этапе .+ не зафиксировано реплик менеджера\.?$/i.test(t)
  )
}

/** Цитаты менеджера, отправленные на данном этапе FSM/разбора */
export function quotesForFeedbackStage(
  log: IntentLogItem[],
  stage: StageId,
): string[] {
  return log
    .filter((i) => i.stage === stage && i.managerQuote?.trim())
    .map((i) => i.managerQuote.trim())
}

/** Реплика похожа на предложение слота / Zoom / next step. */
export function looksLikeClosingProposal(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (containsNextStepKeywords(t) || isClosingStage(t)) return true
  if (hasExplicitDateTimeSlot(t)) return true
  return /(zoom|зуум|демо|слот|созвон|завтра|сегодня|послезавтра|\d{1,2}\s*[:.]\s*\d{2})/i.test(
    t,
  )
}

/**
 * Цитаты closing: сначала FSM-stamp, иначе последняя реплика
 * с Zoom/временем (send-time stamp часто ещё objection/presentation).
 */
export function quotesForClosingWithFallback(
  log: IntentLogItem[],
  messages: string[],
): string[] {
  const stamped = quotesForFeedbackStage(log, 'closing')
  if (stamped.length > 0) return stamped

  // Intent closing без stage stamp
  const byIntent = log
    .filter(
      (i) =>
        (i.intentId === 'closing' ||
          /closing|closing_ok|closing_confirm|closing_need/i.test(
            i.intentId,
          )) &&
        i.managerQuote?.trim(),
    )
    .map((i) => i.managerQuote.trim())
  if (byIntent.length > 0) return byIntent

  // Последняя реплика с closing-keywords
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (looksLikeClosingProposal(m)) return [m]
  }
  return []
}

/**
 * Мягкое упоминание ценности продукта (дашборд, автодожим, модули,
 * автоматизация, отличия) — даже короткое или смешанное с Q/возражением.
 * Diagnostic-вопрос про канал (WhatsApp) без оффера решения — не питч.
 */
export function hasProductValueMention(text: string): boolean {
  if (!text?.trim()) return false
  if (isIntroGreeting(text)) return false
  if (isPresentationStage(text)) return true
  if (
    /(автобот|автоответ|автодожим|дашборд|модул|функц|интеграц|автоматизац|ценност|отлича|едины[йе]\s+(дашборд|экран|систем)|филиал.{0,32}(эконом|управлен|сводк)|эконом\w*\s+филиал|подключаем|подключим|покаж(у|ем)|решени[ея]\s+(для|под|закры)|снижает?\s+(нагрузк|потер)|фиксиру(ет|ем)\s+запис|crm\s+(закры|напомин|писа|модул)|дента)/i.test(
      text,
    )
  ) {
    return true
  }
  // Канал только вместе с оффером решения, не в чистом discovery-вопросе
  if (
    /(whatsapp|ватсап|рассыл|аналитик|календар)/i.test(text) &&
    /(подключа|покаж|модул|автобот|автодожим|интеграц|дашборд|решени)/i.test(
      text,
    )
  ) {
    return true
  }
  return false
}

/**
 * Цитаты presentation: stamp этапа, иначе любая реплика с ценностью продукта
 * (питч мог уйти в stamp discovery/objection/closing или смешаться с вопросом).
 */
export function quotesForPresentationWithFallback(
  log: IntentLogItem[],
  messages: string[],
): string[] {
  const stamped = quotesForFeedbackStage(log, 'presentation').filter(
    (q) => q.trim() && !isStagePlaceholder(q),
  )
  if (stamped.length > 0) {
    const withValue = stamped.filter(hasProductValueMention)
    return withValue.length > 0 ? withValue : stamped
  }

  const seen = new Set<string>()
  const soft: string[] = []
  const push = (q: string) => {
    const key = normalizeQuoteKey(q)
    if (!key || seen.has(key) || isStagePlaceholder(q)) return
    if (!hasProductValueMention(q)) return
    seen.add(key)
    soft.push(q)
  }

  for (const i of log) {
    if (i.managerQuote?.trim()) push(i.managerQuote.trim())
  }
  for (const m of messages) {
    if (m?.trim()) push(m.trim())
  }
  return soft
}

export function hasStagedIntentLog(log: IntentLogItem[]): boolean {
  return log.some((i) => Boolean(i.stage))
}

export type ScoreInsight = {
  id: string
  label: string
  deltaTotal: number
}

export type StageId =
  | 'contact'
  | 'discovery'
  | 'presentation'
  | 'objections'
  | 'closing'

export type Verdict = 'passed' | 'retake'

const STAGE_IDS: StageId[] = [
  'contact',
  'discovery',
  'presentation',
  'objections',
  'closing',
]

export const STAGE_LABELS: Record<StageId, string> = {
  contact: 'Установление контакта',
  discovery: 'Выявление потребностей',
  presentation: 'Презентация решения',
  objections: 'Работа с возражениями',
  closing: 'Завершение сделки / Следующий шаг',
}

const PASS_THRESHOLD = 7

function clamp(n: number, min = 1, max = 10): number {
  return Math.min(max, Math.max(min, n))
}

function round1(n: number): number {
  return Number(clamp(n).toFixed(1))
}

function avg(nums: number[]): number {
  if (!nums.length) return 1
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncateQuote(text: string, max = 160): string {
  const t = normalize(text)
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function count(log: IntentLogItem[], ids: string[]): number {
  return log.filter((i) => ids.includes(i.intentId)).length
}

function firstIndex(log: IntentLogItem[], ids: string[]): number {
  return log.findIndex((i) => ids.includes(i.intentId))
}

function quoteFrom(
  log: IntentLogItem[],
  ids: string[],
  messages: string[],
  fallbackIndex = 0,
  preferredStage?: StageId,
): string {
  if (preferredStage && hasStagedIntentLog(log)) {
    const byIntent = log.find(
      (i) =>
        i.stage === preferredStage &&
        ids.includes(i.intentId) &&
        i.managerQuote?.trim(),
    )
    if (byIntent?.managerQuote) return truncateQuote(byIntent.managerQuote)
    const byStage = quotesForFeedbackStage(log, preferredStage)[0]
    if (byStage) return truncateQuote(byStage)
    return STAGE_NO_QUOTE_PLACEHOLDER[preferredStage]
  }

  const hit = log.find((i) => ids.includes(i.intentId) && i.managerQuote?.trim())
  if (hit?.managerQuote) {
    // Не тащим цитату с чужого этапа, если stage проставлен
    if (
      preferredStage &&
      hit.stage &&
      hit.stage !== preferredStage
    ) {
      const staged = quotesForFeedbackStage(log, preferredStage)[0]
      if (staged) return truncateQuote(staged)
      return STAGE_NO_QUOTE_PLACEHOLDER[preferredStage]
    }
    return truncateQuote(hit.managerQuote)
  }
  if (preferredStage && hasStagedIntentLog(log)) {
    return STAGE_NO_QUOTE_PLACEHOLDER[preferredStage]
  }
  const msg = messages[fallbackIndex] ?? messages[messages.length - 1]
  return truncateQuote(msg || '—')
}

/** Реплики только данного этапа (или все — в legacy без stamp). */
function messagesForStage(
  log: IntentLogItem[],
  stage: StageId,
  allMessages: string[],
): string[] {
  if (hasStagedIntentLog(log)) {
    return quotesForFeedbackStage(log, stage)
  }
  return allMessages
}

function hasQuestion(text: string): boolean {
  return isQuestion(text)
}

function hasPrice(text: string): boolean {
  // Расчёт потерь в ₽ / заявках — не «название цены подписки»
  if (
    containsLossCalcKeywords(text) ||
    /(упуска|потер|теря|заявк|неявк|выручк).{0,48}(₽|руб|тыс)/i.test(text) ||
    /(₽|руб|тыс).{0,48}(упуска|потер|заявк|неявк|выручк)/i.test(text)
  ) {
    return /(подписк|тариф|прайс|сколько\s+стоит|цен[аыуе]\s|по\s+цен)/i.test(
      text,
    )
  }
  return /(цен[аыуе]|стоим|сколько стоит|руб|₽|тыс\.|подписк|прайс|бюджет)/i.test(
    text,
  )
}

function hasLossOrPain(text: string): boolean {
  return /(потер|заявк|неявк|админ|повторн|срыв|простой|убыт|боль|проблем|хаос|забыва)/i.test(
    text,
  )
}

function hasPitch(text: string): boolean {
  return hasProductValueMention(text)
}

function isRoiOrPriceHandle(text: string): boolean {
  return (
    /(окуп|roi|отбив|2\s*кресл|двух\s+кресл|подписк|вилк)/i.test(text) &&
    (hasPrice(text) || /\d+/.test(text) || /кресл/i.test(text))
  )
}

function hasClose(text: string): boolean {
  return containsNextStepKeywords(text)
}

/** Полная рамка контакта: приветствие + имя/компания + цель/минуты. */
const INTRO_NAME_RE =
  /(это\s+[a-zа-яё][a-zа-яё\d-]{1,24}|меня\s+зовут|(?:^|[^a-zа-яё0-9])я\s+[a-zа-яё]{2,24}\s+из\b|(?:^|[^a-zа-яё0-9])я\s+[a-zа-яё]{2,24}\b(?=\s*[,.!]|\s+(?:из|компани|дента)))/i
const INTRO_COMPANY_RE =
  /(компани[яи]|дента\s*crm|дентаcrm|(?:^|[^a-zа-яё0-9])я\s+из\b|из\s+компани)/i

function hasFullContactSetup(text: string | undefined): boolean {
  if (!text?.trim()) return false
  if (isClosingStage(text) || containsNextStepKeywords(text)) return false
  const t = text.toLowerCase().replace(/ё/g, 'е')
  const greet = /(здравств|добр(ый|ое|ого)|привет|алло)/i.test(t)
  const name = INTRO_NAME_RE.test(t)
  const company = INTRO_COMPANY_RE.test(t)
  const goal =
    /(удобно\s+(\d+\s+)?минут|звон(ю|им)|по\s+поводу|хочу\s+(понять|обсудить|уточнить)|потер|запис|сравнива)/i.test(
      t,
    )
  // Имя+компания+цель достаточно; приветствие усиливает
  if (name && company && goal) return true
  if (greet && (name || company) && goal) return true
  if (greet && name && company) return true
  return false
}

/**
 * Явное представление: «я [Имя]», «из [Компания]», ДентаCRM, «это Тихон…».
 */
function hasIntroductionSignals(text: string | undefined): boolean {
  if (!text?.trim()) return false
  const t = text.toLowerCase().replace(/ё/g, 'е')
  if (/(дента\s*crm|дентаcrm)/i.test(t)) return true
  if (INTRO_NAME_RE.test(t) || INTRO_COMPANY_RE.test(t)) return true
  return false
}

/** Чистая техника без представления — конец «раннего» окна контакта. */
function isPureTechnicalDiscussion(text: string): boolean {
  if (hasIntroductionSignals(text) || hasFullContactSetup(text)) return false
  if (isClosingStage(text) || containsNextStepKeywords(text)) return true
  if (isDiscoveryDiagnosticQuote(text)) return true
  if (isPresentationStage(text)) return true
  return false
}

export type EarlyContactHit = {
  index: number
  text: string
  fullSetup: boolean
  hasValidIntroduction: boolean
}

/**
 * Сканирует историю: представление на любом раннем ходе
 * (до discovery/pitch/closing без ID) засчитывается.
 * Пример: offtopic → «Здравствуйте, я Тихон из ДентаCRM» → OK.
 */
export function findEarlyContactIntroduction(
  messages: string[],
): EarlyContactHit | null {
  let hit: EarlyContactHit | null = null
  for (let i = 0; i < messages.length; i++) {
    const text = messages[i]!
    if (!text?.trim()) continue

    if (isPureTechnicalDiscussion(text)) {
      break
    }

    const fullSetup = hasFullContactSetup(text)
    const introSignals = hasIntroductionSignals(text)
    const frame =
      fullSetup ||
      (isContactFrameQuote(text) &&
        !isDiscoveryDiagnosticQuote(text) &&
        !isClosingStage(text) &&
        introSignals) ||
      (isIntroGreeting(text) && introSignals) ||
      introSignals

    if (!frame) continue

    const candidate: EarlyContactHit = {
      index: i,
      text,
      fullSetup,
      hasValidIntroduction: fullSetup || introSignals,
    }
    if (!hit || (fullSetup && !hit.fullSetup)) {
      hit = candidate
    }
    if (fullSetup) break
  }
  return hit
}

function hasValidIntroductionFlag(messages: string[]): boolean {
  const hit = findEarlyContactIntroduction(messages)
  return Boolean(hit?.hasValidIntroduction || hit?.fullSetup)
}

/** Первое «добрый день / это X, Компания / удобно N минут» — только контакт. */
function isIntroGreeting(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/ё/g, 'е')
  if (containsProfanity(t)) return false
  // Closing / next-step (Zoom, слот) никогда не рамка контакта
  if (isClosingStage(text) || containsNextStepKeywords(text)) return false
  // Явное представление + проверка удобства (кириллические имена: «Это Тихон…»)
  if (
    (INTRO_NAME_RE.test(t) || INTRO_COMPANY_RE.test(t)) &&
    /(удобно|минут|здравств|добр)/i.test(t)
  ) {
    return true
  }
  if (containsGreetingKeywords(t) && !hasPrice(t)) return true
  // «Удобно 2 минуты?» без «добрый день» — но не «удобно в 11:00» слот
  if (
    /удобно\s+(\d+\s+)?минут/i.test(t) &&
    t.length < 120 &&
    !/(zoom|зуум|слот|демо|завтра|сегодня)/i.test(t)
  ) {
    return true
  }
  return false
}

/** Индекс реплики менеджера (0 = Turn 1). −1 если цитата не из messages. */
function quoteTurnIndex(quote: string, messages: string[]): number {
  const key = normalizeQuoteKey(quote)
  if (!key || key === '—') return -1
  for (let i = 0; i < messages.length; i++) {
    const mk = normalizeQuoteKey(messages[i]!)
    if (mk === key) return i
    if (key.length >= 12 && (mk.includes(key) || key.includes(mk))) return i
  }
  return -1
}

function isBlankQuote(q: string | undefined | null): boolean {
  const key = normalizeQuoteKey(q ?? '')
  return !key || key === '—'
}

function isAggressive(text: string): boolean {
  return containsProfanity(text)
}

function quoteClose(messages: string[], log: IntentLogItem[]): string {
  const pool = quotesForClosingWithFallback(log, messages)
  const timed =
    pool.find(
      (m) =>
        hasClose(m) &&
        (/\d{1,2}\s*[:.]\s*\d{2}/.test(m) ||
          /(завтра|слот|zoom|демо)/i.test(m)),
    ) ||
    pool.find(hasClose) ||
    pool.find(looksLikeClosingProposal) ||
    pool[0]
  if (timed) return truncateQuote(timed)
  if (hasStagedIntentLog(log)) return STAGE_NO_QUOTE_PLACEHOLDER.closing
  return quoteFrom(log, ['closing'], messages, 0, 'closing')
}

function isTooShort(text: string): boolean {
  return normalize(text).length > 0 && normalize(text).length < 28
}

/** Лёгкая проверка «есть экономика/цифры» для ответа на hard-gate. */
function managerProvedValueLite(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  if (/(окупаем|\broi\b|отбив|в цифрах)/i.test(t)) return true
  if (
    /(\d+[.,]?\d*)\s*(тыс\.?|тысяч|₽|руб|%)/i.test(t) &&
    /(потер|выручк|неявк|заявк|окуп)/i.test(t)
  ) {
    return true
  }
  return false
}

type DraftMistake = FeedbackMistake & { weight: number }
type DraftSuccess = FeedbackSuccess & { weight: number }

/**
 * Сухой ROP-разбор по реальным репликам менеджера.
 * Не опирается на «мягкий» шаблон клиента — считает с нуля.
 */
export function analyzeRoleplayFeedback(input: {
  managerMessages: string[]
  intentLog?: IntentLogItem[]
  clientName?: string
  /** Финальный снимок FSM — усиливает аналитику */
  dialogueState?: {
    stage?: string
    mood?: { trust: number; interest: number; irritation: number }
    slots?: {
      painFound?: boolean
      priceAskedEarly?: boolean
      demoOffered?: boolean
      developedArgument?: boolean
      pitched?: boolean
      objectionHandled?: boolean
      /** Hard-gate / persona pushback уже был в диалоге */
      personaPushbackShown?: boolean
      hasHandledObjection?: boolean
      closingAttempts?: number
      priceDiscussed?: boolean
      legacyCrmRaised?: boolean
      replacementPitchError?: boolean
      integrationPitchOk?: boolean
    }
    sessionStatus?:
      | 'active'
      | 'warning'
      | 'failed'
      | 'completed'
      | 'terminated_etiquette'
      | 'terminated_offtopic'
    failReason?:
      | 'toxicity_limit_exceeded'
      | 'terminated_etiquette'
      | 'terminated_offtopic'
      | null
    warningCount?: number
  }
}): {
  feedback: FeedbackResult
  insights: ScoreInsight[]
} {
  const messages = input.managerMessages.map(normalize).filter(Boolean)
  const intentLog = input.intentLog ?? []
  const stagedLog = hasStagedIntentLog(intentLog)
  const slots = input.dialogueState?.slots
  const mood = input.dialogueState?.mood
  const insights: ScoreInsight[] = []

  const offtopicFailed =
    input.dialogueState?.failReason === 'terminated_offtopic' ||
    input.dialogueState?.sessionStatus === 'terminated_offtopic'

  if (offtopicFailed) {
    const offtopicQuote =
      quoteFrom(intentLog, ['offtopic_confused', 'nonsense_spam', 'smalltalk_redirect'], messages) ||
      messages[messages.length - 1] ||
      '—'

    const stageScores: FeedbackStageScore[] = STAGE_IDS.map((id) => ({
      stageId: id,
      score: 1.0,
      comment:
        id === 'contact'
          ? 'КРИТИЧЕСКАЯ ОШИБКА • Предметный разговор. Сессия прервана (3+ off-topic).'
          : 'Этап не оценивался — диалог прерван из‑за ухода от темы продаж.',
    }))

    return {
      feedback: {
        totalScore: 1.0,
        stageScores,
        mistakes: [
          {
            stageId: 'contact',
            managerQuote: truncateQuote(offtopicQuote),
            comment:
              'Три подряд реплики без sales-контекста и без валидного ответа. Клиент завершил разговор.',
            betterScript:
              'Держите фокус на задаче клиники: представление, боль, ценность, следующий шаг.',
            tag: 'offtopic_violation',
          },
        ],
        successes: [],
        recommendations: [
          'Говорите по делу: боль клиники, CRM, демо, слот.',
          'Пересдача обязательна — сначала предметный контакт.',
        ],
        verdict: 'retake',
        verdictLabel: 'ТРЕБУЕТСЯ ПЕРЕСДАЧА',
        mainRecommendation:
          'Три подряд реплики вне темы продаж. Сессия прервана автоматически.',
        failReason: 'terminated_offtopic',
        offTopicViolation: true,
      },
      insights: [
        {
          id: 'OFFTOPIC_VIOLATION',
          label: 'КРИТИЧЕСКАЯ ОШИБКА • Вне темы (−total → 1.0)',
          deltaTotal: -9,
        },
      ],
    }
  }

  const toxicityFailed =
    input.dialogueState?.failReason === 'toxicity_limit_exceeded' ||
    input.dialogueState?.failReason === 'terminated_etiquette' ||
    input.dialogueState?.sessionStatus === 'failed' ||
    input.dialogueState?.sessionStatus === 'terminated_etiquette'

  if (toxicityFailed) {
    const toxicQuote =
      [...messages].reverse().find(isAggressive) ||
      messages.find(isAggressive) ||
      quoteFrom(intentLog, ['aggression_pushback'], messages) ||
      messages[messages.length - 1] ||
      '—'

    const stageScores: FeedbackStageScore[] = STAGE_IDS.map((id) => ({
      stageId: id,
      score: 1.0,
      comment:
        id === 'contact'
          ? 'КРИТИЧЕСКАЯ ОШИБКА • Деловая этика. Сессия прервана (2+ нарушения).'
          : 'Этап не оценивался — диалог прерван из‑за нарушения деловой этики.',
    }))

    return {
      feedback: {
        totalScore: 1.0,
        stageScores,
        mistakes: [
          {
            stageId: 'contact',
            managerQuote: truncateQuote(toxicQuote),
            comment:
              'Использование ненормативной лексики и оскорблений (2+ нарушения). Сессия прервана автоматически.',
            betterScript:
              'Сохраняйте профессиональный тон общения в любых ситуациях.',
            tag: 'etiquette_violation',
          },
        ],
        successes: [],
        recommendations: [
          'Сохраняйте профессиональный тон общения в любых ситуациях.',
          'Пересдача обязательна — сначала контакт и уважение к ЛПР.',
        ],
        verdict: 'retake',
        verdictLabel: 'ТРЕБУЕТСЯ ПЕРЕСДАЧА',
        mainRecommendation:
          'Использование ненормативной лексики и оскорблений (2+ нарушения). Сессия прервана автоматически.',
        failReason: 'terminated_etiquette',
        etiquetteViolation: true,
      },
      insights: [
        {
          id: 'ETIQUETTE_VIOLATION',
          label: 'КРИТИЧЕСКАЯ ОШИБКА • Деловая этика (−total → 1.0)',
          deltaTotal: -9,
        },
      ],
    }
  }

  const priceIds = ['price_inquiry', 'price_objection']
  const discoveryIds = ['need_discovery', 'value_challenge']
  const closingIds = ['closing']
  const pitchIds = ['product_pitch_response']
  const competitorIds = ['trust_competitors']
  const doubtIds = ['doubt_skepticism', 'authority_gate', 'timing_busy']
  const offtopicIds = [
    'offtopic_confused',
    'aggression_pushback',
    'nonsense_spam',
    'smalltalk_redirect',
    'rapport_pushback',
  ]

  const firstPrice = firstIndex(intentLog, priceIds)
  const firstDiscovery = firstIndex(intentLog, discoveryIds)
  const firstPitch = firstIndex(intentLog, pitchIds)
  const firstClosing = firstIndex(intentLog, closingIds)
  const discoveryCount = count(intentLog, discoveryIds)
  const offtopicCount = count(intentLog, offtopicIds)

  const textHasDiscovery =
    messages.some(
      (m) => hasQuestion(m) && (hasLossOrPain(m) || discoveryCount > 0),
    ) || messages.some((m) => isDiscoveryDiagnosticQuote(m))
  const textDiscoveryQs = messages.filter(
    (m) =>
      isDiscoveryDiagnosticQuote(m) ||
      (hasQuestion(m) &&
        (hasLossOrPain(m) || /как|сколько|какие|кто/.test(m.toLowerCase()))),
  ).length
  const textPriceEarly =
    messages.findIndex(hasPrice) !== -1 &&
    (messages.findIndex((m) => hasQuestion(m) && hasLossOrPain(m)) === -1 ||
      messages.findIndex(hasPrice) <
        messages.findIndex((m) => hasQuestion(m) && hasLossOrPain(m)))
  const textHasClose = messages.some(hasClose) || firstClosing !== -1
  const softPitchQuotes = quotesForPresentationWithFallback(intentLog, messages)
  const softHasProductValue =
    softPitchQuotes.length > 0 || messages.some(hasProductValueMention)
  const textHasPitch =
    messages.some(hasPitch) || firstPitch !== -1 || softHasProductValue
  const shortCount = messages.filter(isTooShort).length
  const aggressive = messages.some(isAggressive)
  /** Клиент ускорил к слоту; менеджер поддержал — общая логика продажи без развёрнутого питч-таймлайна. */
  const clientJumpedToSlot =
    textHasClose &&
    (discoveryCount > 0 || textHasDiscovery || textDiscoveryQs > 0) &&
    !aggressive

  // База: средний ROP не раздаёт «восьмёрки» за факт участия.
  const scores: Record<StageId, number> = {
    contact: 5.2,
    discovery: 4.8,
    presentation: 5.0,
    objections: 5.0,
    closing: 4.5,
  }

  const comments: Record<StageId, string> = {
    contact: 'Контакт формальный. Нет фиксации роли и повестки разговора.',
    discovery:
      'Потребности не собраны. Нет цифр потерь, нет картины процесса клиники.',
    presentation:
      'Презентация без привязки к боли — звучит как каталог функций.',
    objections:
      'Возражения отрабатываются слабо: нет пересчёта в деньги и риски.',
    closing: 'Сделка не закрыта. Нет конкретного next step с датой и каналом.',
  }

  const mistakes: DraftMistake[] = []
  const successes: DraftSuccess[] = []

  const pushMistake = (m: Omit<DraftMistake, 'weight'> & { weight?: number }) => {
    const quote = truncateQuote(m.managerQuote)
    if (containsProfanity(quote) || m.tag === 'etiquette_violation') {
      mistakes.push({
        weight: m.weight ?? 1,
        stageId: 'contact',
        managerQuote: quote,
        comment: 'Разговор сорван из-за нарушения деловой этики',
        betterScript: undefined,
        tag: 'etiquette_violation',
      })
      return
    }
    mistakes.push({ weight: m.weight ?? 1, ...m, managerQuote: quote })
  }

  const pushSuccess = (s: Omit<DraftSuccess, 'weight'> & { weight?: number }) => {
    successes.push({ weight: s.weight ?? 1, ...s, managerQuote: truncateQuote(s.managerQuote) })
  }

  // —— CONTACT ——
  const earlyContact = findEarlyContactIntroduction(messages)
  const hasValidIntroduction = hasValidIntroductionFlag(messages)
  const contactQuote = earlyContact?.text ?? messages[0]

  if (messages.length === 0) {
    scores.contact = 2.0
    comments.contact =
      'Диалог пустой. Контакт не установлен — оценивать нечего.'
    insights.push({
      id: 'empty',
      label: 'Пустой диалог (− к итогу)',
      deltaTotal: -2,
    })
  } else if (aggressive || count(intentLog, ['aggression_pushback']) > 0) {
    scores.contact -= 2.2
    comments.contact =
      'Тон срывает доверие. РОП такое на реальном звонке останавливает сразу.'
    pushMistake({
      stageId: 'contact',
      weight: 5,
      managerQuote:
        messages.find(isAggressive) ??
        quoteFrom(intentLog, ['aggression_pushback'], messages),
      comment: 'Разговор сорван из-за нарушения деловой этики',
      betterScript: undefined,
      tag: 'etiquette_violation',
    })
    insights.push({
      id: 'ETIQUETTE_VIOLATION',
      label: 'ETIQUETTE_VIOLATION (−contact)',
      deltaTotal: -0.5,
    })
  } else if (earlyContact?.fullSetup || (contactQuote && hasFullContactSetup(contactQuote))) {
    // Полная рамка на раннем ходе (не только Turn 1)
    scores.contact = 10.0
    comments.contact =
      'Представление и цель звонка озвучены корректно.'
    pushSuccess({
      stageId: 'contact',
      weight: 3,
      managerQuote: contactQuote!,
      comment:
        'Есть вход в контакт: приветствие / представление и цель. Этап — только «Установление контакта».',
    })
  } else if (
    hasValidIntroduction &&
    contactQuote &&
    !aggressive &&
    !isDiscoveryDiagnosticQuote(contactQuote) &&
    !isClosingStage(contactQuote) &&
    !containsNextStepKeywords(contactQuote)
  ) {
    scores.contact = Math.max(scores.contact, 8.0)
    comments.contact =
      'Представление и цель звонка озвучены корректно.'
    pushSuccess({
      stageId: 'contact',
      weight: 2,
      managerQuote: contactQuote,
      comment:
        'Есть вход в контакт: приветствие / представление. Этап — только «Установление контакта».',
    })
  } else if (offtopicCount >= 2 || shortCount >= Math.max(2, Math.ceil(messages.length * 0.5))) {
    scores.contact -= 1.4
    comments.contact =
      'Много коротких/размытых реплик. Рамка разговора не удерживается.'
    pushMistake({
      stageId: 'contact',
      weight: 2,
      managerQuote:
        contactQuote &&
        !isDiscoveryDiagnosticQuote(contactQuote) &&
        !isClosingStage(contactQuote)
          ? contactQuote
          : messages[0] &&
              !isDiscoveryDiagnosticQuote(messages[0]) &&
              !isClosingStage(messages[0])
            ? messages[0]
            : '—',
      comment:
        'Короткие обрывки не задают статус, роль и цель звонка. Клиент не понимает, зачем тратит время.',
      betterScript: weakStageBetterScript('contact', contactQuote ?? messages[0]),
    })
  } else if (
    messages[0] &&
    /(здравств|добр|удобно|минут)/i.test(messages[0]) &&
    !aggressive &&
    !isDiscoveryDiagnosticQuote(messages[0]) &&
    !isClosingStage(messages[0]) &&
    !containsNextStepKeywords(messages[0])
  ) {
    scores.contact += 1.0
    comments.contact =
      'Контакт рабочий: есть приветствие и проверка удобства.'
    pushSuccess({
      stageId: 'contact',
      weight: 1,
      managerQuote: messages[0],
      comment:
        'Есть вход в контакт и проверка удобства — минимальный стандарт соблюдён.',
    })
  } else if (!aggressive && messages.length > 0) {
    scores.contact += 0.4
  }

  // Нет рамки контакта на старте — session-level (скан ранних реплик)
  const hasContactFrame = Boolean(
    earlyContact &&
      (earlyContact.fullSetup ||
        earlyContact.hasValidIntroduction ||
        (isContactFrameQuote(earlyContact.text) &&
          !isDiscoveryDiagnosticQuote(earlyContact.text) &&
          !isClosingStage(earlyContact.text))),
  )
  // Не ставим штраф, если уже есть SUCCESS по контакту / валидное представление
  const contactSuccessAlready = successes.some((s) => s.stageId === 'contact')
  if (
    !hasContactFrame &&
    !hasValidIntroduction &&
    !contactSuccessAlready &&
    messages.length > 0 &&
    !aggressive
  ) {
    scores.contact = Math.min(scores.contact, 4.0)
    comments.contact =
      'На старте не хватило четкого представления или цели звонка.'
    insights.push({
      id: 'MISSING_FRAME_ERROR',
      label: 'На старте не хватило четкого представления или цели звонка (−contact)',
      deltaTotal: -0.4,
    })
  } else if (hasContactFrame || hasValidIntroduction) {
    if (earlyContact?.fullSetup || (contactQuote && hasFullContactSetup(contactQuote))) {
      scores.contact = 10.0
    } else if (hasValidIntroduction) {
      scores.contact = Math.max(scores.contact, 8.0)
    }
    for (let i = insights.length - 1; i >= 0; i--) {
      if (insights[i]!.id === 'MISSING_FRAME_ERROR') insights.splice(i, 1)
    }
    if (
      /MISSING_FRAME|не хватило четкого представления/i.test(comments.contact) ||
      !comments.contact ||
      comments.contact === 'Этап без явных сигналов в репликах.'
    ) {
      comments.contact =
        'Представление и цель звонка озвучены корректно.'
    }
  }

  // —— DISCOVERY ——
  const priceBeforeDiscovery =
    slots?.priceAskedEarly === true ||
    (firstPrice !== -1 && (firstDiscovery === -1 || firstPrice < firstDiscovery)) ||
    textPriceEarly

  if (slots?.painFound) {
    scores.discovery = Math.max(scores.discovery, 6.2)
  }
  if (slots?.demoOffered) {
    scores.closing = Math.max(scores.closing, 6.8)
  }
  if (slots?.developedArgument) {
    scores.presentation += 0.6
    scores.objections += 0.4
  }
  if (mood && mood.irritation >= 7) {
    scores.contact -= 1.2
    insights.push({
      id: 'high_irritation',
      label: 'Клиент раздражён (mood)',
      deltaTotal: -0.4,
    })
  }
  if (mood && mood.trust >= 7 && mood.interest >= 6) {
    insights.push({
      id: 'warm_mood',
      label: 'Доверие клиента высокое',
      deltaTotal: 0.3,
    })
    scores.contact += 0.4
  }

  if (priceBeforeDiscovery) {
    scores.discovery -= 2.4
    scores.objections -= 0.8
    comments.discovery =
      'Цена/цифры до диагностики. Классическая ошибка junior-а.'
    pushMistake({
      stageId: 'discovery',
      weight: 4,
      managerQuote: quoteFrom(
        intentLog,
        priceIds,
        messages,
        messages.findIndex(hasPrice),
        'discovery',
      ),
      comment:
        'Назвали или спросили цену до болей. Без потерь в рублях цена всегда «дорого». Сначала диагностика, потом цифра.',
      betterScript:
        'До цифр уточню: сколько заявок в неделю не доходит до визита и сколько стоит один сорванный приём для клиники? От этого зависит, имеет ли смысл вообще смотреть стоимость.',
    })
    insights.push({
      id: 'price_before_discovery',
      label: 'Цена до discovery',
      deltaTotal: -0.7,
    })
  }

  if (discoveryCount >= 2 || textDiscoveryQs >= 2) {
    scores.discovery += 2.8
    comments.discovery =
      'Есть серия вопросов о ситуации — discovery выглядит рабочим.'
    const q =
      quoteFrom(intentLog, discoveryIds, messages, 0, 'discovery') ||
      (!stagedLog
        ? messages.find((m) => isDiscoveryDiagnosticQuote(m)) ||
          messages.find((m) => hasQuestion(m) && hasLossOrPain(m)) ||
          messages.find(hasQuestion)
        : quotesForFeedbackStage(intentLog, 'discovery')[0])
    if (q && !isStagePlaceholder(q)) {
      pushSuccess({
        stageId: 'discovery',
        weight: 3,
        managerQuote: q,
        comment:
          'Сильный приём: вопрос про процесс/потери. Так собирается почва под ценность.',
      })
    }
    insights.push({
      id: 'strong_discovery',
      label: 'Сильный discovery',
      deltaTotal: 0.4,
    })
  } else if (discoveryCount === 1 || textDiscoveryQs === 1 || textHasDiscovery) {
    scores.discovery += 1.1
    comments.discovery =
      'Заход в потребности был, но глубины не хватило (мало цифр и follow-up).'
    const q =
      messages.find((m) => isDiscoveryDiagnosticQuote(m)) ||
      messages.find((m) => hasQuestion(m) && hasLossOrPain(m)) ||
      messages.find(hasQuestion)
    if (q) {
      pushSuccess({
        stageId: 'discovery',
        weight: 2,
        managerQuote: q,
        comment:
          'Диагностический вопрос — этап «Выявление потребностей» (даже если рамка контакта пропущена).',
      })
    }
  } else if (messages.length > 0) {
    scores.discovery -= 1.8
    comments.discovery =
      'Discovery почти отсутствует. Продажа шла «в молоко».'
    pushMistake({
      stageId: 'discovery',
      weight: 3.5,
      managerQuote: messages.find((m) => !hasQuestion(m)) ?? messages[0]!,
      comment:
        'Нет диагностических вопросов о потерях заявок, администраторе и повторных визитах. Без этого презентация — шум.',
      betterScript:
        'Как сейчас администратор обрабатывает входящие? Сколько неявок в неделю и кто за это отвечает? Где чаще всего «теряется» пациент между заявкой и креслом?',
    })
    insights.push({
      id: 'no_discovery',
      label: 'Нет discovery',
      deltaTotal: -0.5,
    })
  }

  // —— PRESENTATION ——
  // Содержательный зачёт: любая ценность продукта в логе (не только stamp presentation).
  if (
    firstPitch !== -1 &&
    (firstDiscovery === -1 || firstPitch < firstDiscovery) &&
    !textHasDiscovery
  ) {
    scores.presentation -= 1.8
    comments.presentation =
      'Питч раньше диагностики. Функции без боли не конвертятся.'
    pushMistake({
      stageId: 'presentation',
      weight: 3,
      managerQuote: quoteFrom(
        intentLog,
        pitchIds,
        messages,
        messages.findIndex(hasPitch),
        'presentation',
      ),
      comment:
        'Перечисление возможностей CRM до фиксации проблемы. Клиент слышит «нам впаривают», а не «нам считают потери».',
      betterScript:
        'Если у вас 8–12 неявок в неделю, модуль напоминаний и очередь WhatsApp как раз закрывают эту дыру — покажу только эти два блока, без экскурсии по всему продукту.',
    })
    insights.push({
      id: 'pitch_before_discovery',
      label: 'Презентация до боли',
      deltaTotal: -0.4,
    })
  } else if (softHasProductValue && (discoveryCount > 0 || textHasDiscovery)) {
    scores.presentation += 2.0
    comments.presentation =
      'Презентация хотя бы частично завязана на контекст клиента.'
    const pitchPool = softPitchQuotes.length
      ? softPitchQuotes
      : messagesForStage(intentLog, 'presentation', messages)
    const pitchQuote =
      pitchPool.find((m) => hasPitch(m) && hasLossOrPain(m)) ||
      pitchPool.find(hasPitch) ||
      softPitchQuotes[0] ||
      (stagedLog
        ? quotesForFeedbackStage(intentLog, 'presentation')[0]
        : messages.find((m) => hasPitch(m) && hasLossOrPain(m)) ||
          messages.find(hasPitch))
    if (pitchQuote && !isStagePlaceholder(pitchQuote) && !isIntegrationPitch(pitchQuote)) {
      pushSuccess({
        stageId: 'presentation',
        weight: 3,
        managerQuote: pitchQuote,
        comment:
          'Есть связка «боль → решение». Так и должен звучать питч.',
      })
    }
  } else if (softHasProductValue) {
    // Ценность озвучена (даже коротко / в смеси с Q или возражением) — этап засчитан.
    scores.presentation += 2.0
    comments.presentation =
      'В диалоге зафиксирована ценность продукта (модули / автоматизация / отличия) — этап засчитан по содержанию.'
    const pitchQuote =
      softPitchQuotes[0] ||
      messages.find(hasProductValueMention) ||
      quotesForFeedbackStage(intentLog, 'presentation')[0]
    if (
      pitchQuote &&
      !isStagePlaceholder(pitchQuote) &&
      !isIntegrationPitch(pitchQuote)
    ) {
      pushSuccess({
        stageId: 'presentation',
        weight: 3,
        managerQuote: pitchQuote,
        comment: whyWorkedForStage('presentation'),
      })
    }
  } else if (
    stagedLog &&
    quotesForFeedbackStage(intentLog, 'presentation').length > 0
  ) {
    // Stage-stamp presentation even if text heuristic missed hasPitch
    const pitchQuote = quotesForFeedbackStage(intentLog, 'presentation')[0]!
    scores.presentation += 2.0
    comments.presentation =
      'Презентация зафиксирована на этапе presentation (FSM).'
    pushSuccess({
      stageId: 'presentation',
      weight: 2,
      managerQuote: pitchQuote,
      comment: whyWorkedForStage('presentation'),
    })
  } else if (clientJumpedToSlot) {
    // Клиент перебил / сразу слот; менеджер поддержал — без ложного штрафа.
    comments.presentation =
      'Клиент ускорил к слоту; общая логика продажи соблюдена — без штрафа за сжатую презентацию.'
  } else if (messages.some(isAbstractBenefitOnly)) {
    scores.presentation -= 1.0
    comments.presentation =
      'Абстрактная «выгода» без метрик кресел/удержания и цифр — этап не закрыт.'
    const watery =
      messages.find(isAbstractBenefitOnly) || messages[messages.length - 1]!
    pushMistake({
      stageId: 'presentation',
      weight: 2.6,
      managerQuote: watery,
      comment:
        'Общие обещания «удобнее/выгоднее» без загрузки кресел, возврата пациентов и конкретных %/₽.',
      betterScript:
        'На двух креслах: +8–12% загрузки и −2–3 неявки в неделю обычно закрывают подписку за месяц — сверю с вашей статистикой.',
    })
  } else if (messages.length >= 2) {
    scores.presentation -= 0.8
    comments.presentation =
      'Решение почти не презентовалось. Клиент не увидел, что меняется в его процессе.'
  }

  // Качество экономики: HQ-бонус; абстрактная выгода уже оштрафована выше
  {
    const hq = messages.some((m) => evaluateValuePitch(m).isHighQualityValue)
    if (hq && (softHasProductValue || textHasPitch)) {
      scores.presentation = Math.max(scores.presentation, 7.8)
      comments.presentation =
        'Презентация с конкретной экономикой: метрики клиники + цифры.'
    } else if (softHasProductValue && !hq) {
      comments.presentation = `${comments.presentation} Усильте связку: загрузка кресел / возврат пациентов + % или ₽.`
    }
  }

  // —— OBJECTIONS ——
  const priceMsgs = messages.filter(hasPrice)
  const priceWithEconomics = priceMsgs.some(
    (m) => hasLossOrPain(m) || /(окуп|неявк|потеря|roi|отбив)/i.test(m),
  )
  const barePrice =
    priceMsgs.find(
      (m) =>
        !hasLossOrPain(m) &&
        !containsLossCalcKeywords(m) &&
        !/(окуп|roi|отбив)/i.test(m),
    ) || null

  /** Hard-gate Zoom/busy pushback клиента = OBJECTION_RAISED */
  const hardGateObjection =
    Boolean(slots?.personaPushbackShown) ||
    Boolean(slots?.hasHandledObjection) ||
    ((slots?.closingAttempts ?? 0) >= 1 && Boolean(slots?.personaPushbackShown))

  const facedExplicitObjection =
    count(intentLog, ['price_objection']) > 0 ||
    count(intentLog, competitorIds) > 0 ||
    count(intentLog, doubtIds) > 0 ||
    Boolean(slots?.objectionHandled) ||
    Boolean(slots?.legacyCrmRaised) ||
    Boolean(slots?.replacementPitchError) ||
    Boolean(slots?.integrationPitchOk) ||
    messages.some(
      (m) =>
        mentionsLegacyCrm(m) ||
        isFullReplacementPitch(m) ||
        isIntegrationPitch(m),
    ) ||
    hardGateObjection

  /** Этапы без фактуры — не штрафуем и не требуем ERROR-карточку */
  const insufficientData = new Set<StageId>()

  const replacementHit = messages.find(isFullReplacementPitch)
  const integrationHit = messages.find(isIntegrationPitch)
  const legacyFaced =
    Boolean(slots?.legacyCrmRaised) ||
    Boolean(slots?.replacementPitchError) ||
    messages.some(mentionsLegacyCrm) ||
    count(intentLog, competitorIds) > 0

  if (replacementHit || slots?.replacementPitchError) {
    scores.objections = Math.min(scores.objections, 4.5) - 1.4
    comments.objections =
      'Ошибка стратегии: предложена замена рабочей МИС — клиники так не меняют 1С/Инфодент.'
    pushMistake({
      stageId: 'objections',
      weight: 3.6,
      managerQuote: truncateQuote(
        replacementHit ||
          messages.find(mentionsLegacyCrm) ||
          messages[messages.length - 1]!,
      ),
      comment:
        'Полная замена 1С/Инфодент «в лоб» — риск базы и завышенные затраты. Клиент уходит в жёсткий pushback.',
      betterScript:
        'Мы не меняем вашу 1С — модуль поверх: интеграция, автодожим и дашборд. На двух креслах +8–12% загрузки обычно отбивает подписку за недели.',
    })
    insights.push({
      id: 'legacy_replacement_error',
      label: 'Замена МИС (ошибка)',
      deltaTotal: -0.6,
    })
  } else if (integrationHit || slots?.integrationPitchOk) {
    scores.objections = Math.max(scores.objections, 6.8) + 1.4
    comments.objections =
      'Верная рамка: продукт как модуль/интеграция поверх текущей МИС, дальше экономика.'
    pushSuccess({
      stageId: 'objections',
      weight: 3.5,
      managerQuote: truncateQuote(
        integrationHit ||
          messages.find(mentionsLegacyCrm) ||
          messages[messages.length - 1]!,
      ),
      comment:
        'Интеграция / «поверх 1С» — правильный ответ на «у нас уже есть МИС».',
    })
    insights.push({
      id: 'legacy_integration_ok',
      label: 'Интеграция поверх МИС',
      deltaTotal: 0.5,
    })
  } else if (!facedExplicitObjection && !barePrice) {
    scores.objections = 8.0
    comments.objections =
      'НЕДОСТАТОЧНО ДАННЫХ: явного возражения клиента в диалоге не было — этап не штрафуем.'
    insufficientData.add('objections')
  } else if (hardGateObjection && count(intentLog, ['price_objection']) === 0 && !legacyFaced) {
    // Клиент дал hard-gate («Подождите с Zoom…») — оцениваем ответ менеджера
    const afterPushback =
      messages.find(
        (m) =>
          (hasPrice(m) || containsLossCalcKeywords(m) || managerProvedValueLite(m)) &&
          !isIntroGreeting(m),
      ) ||
      messages.find(
        (m) =>
          hasClose(m) &&
          (hasPrice(m) || containsLossCalcKeywords(m) || /(окуп|roi|цифр)/i.test(m)),
      ) ||
      [...messages].reverse().find((m) => !isIntroGreeting(m) && !isTooShort(m))

    const handledWell =
      Boolean(slots?.hasHandledObjection) &&
      (Boolean(slots?.developedArgument) ||
        Boolean(slots?.priceDiscussed) ||
        Boolean(slots?.objectionHandled) ||
        messages.some(
          (m) =>
            (hasPrice(m) && (hasLossOrPain(m) || /(окуп|roi|отбив)/i.test(m))) ||
            containsLossCalcKeywords(m),
        ))

    if (handledWell && afterPushback) {
      scores.objections = Math.max(scores.objections, 6.5) + 1.5
      comments.objections =
        'На возражение «подождите с Zoom / откуда цифра» ответили экономикой — рамка верная.'
      pushSuccess({
        stageId: 'objections',
        weight: 2.8,
        managerQuote: truncateQuote(afterPushback),
        comment:
          'После hard-gate клиента вернулись к цифрам/окупаемости, а не продавили слот в лоб.',
      })
    } else {
      scores.objections = Math.min(scores.objections, 5.5) - 0.8
      comments.objections =
        'Клиент дал возражение (занятость/скепсис по Zoom). Ответ слабо закрыл экономику и сомнение.'
      const weakQuote =
        afterPushback ||
        messages.find(hasClose) ||
        messages.find(hasPrice) ||
        messages[messages.length - 1] ||
        messages[0]!
      pushMistake({
        stageId: 'objections',
        weight: 3.4,
        managerQuote: truncateQuote(weakQuote),
        comment:
          'На «подождите с Zoom / откуда 50 тысяч» нужен короткий ответ: источник цифры + окупаемость, и только потом слот.',
        betterScript:
          'Цифра из типичных двух кресел: 3–5 сорванных визитов × чек. Если вернём хотя бы часть — подписка отбивается за недели. Давайте 10 минут сверю с вашей статистикой — без обязательств.',
      })
    }
    insights.push({
      id: 'hard_gate_objection',
      label: 'OBJECTION_RAISED (hard-gate Zoom)',
      deltaTotal: handledWell ? 0.2 : -0.2,
    })
  } else if (count(intentLog, ['price_objection']) > 0) {
    const handledWithValue =
      discoveryCount > 0 || messages.some((m) => hasPrice(m) && hasLossOrPain(m))
    if (handledWithValue) {
      scores.objections += 1.8
      comments.objections =
        'На цену был ответ через ценность/потери — это правильная рамка.'
      pushSuccess({
        stageId: 'objections',
        weight: 2.5,
        managerQuote: quoteFrom(intentLog, ['price_objection'], messages),
        comment:
          'Возражение по цене не ушло в скидку — перевели в экономику потерь.',
      })
    } else {
      scores.objections -= 1.6
      comments.objections =
        '«Дорого» отработано слабо. Нет расчёта потерь, есть риск скидки/оправдания.'
      pushMistake({
        stageId: 'objections',
        weight: 3.2,
        managerQuote: quoteFrom(intentLog, ['price_objection'], messages),
        comment:
          'Ценовое возражение закрывают экономикой: стоимость неявки × частота × месяц. Скидка без этого — признак слабости.',
        betterScript:
          'Понимаю про бюджет. Давайте в цифрах: одна неявка ≈ X ₽. Если система снимает хотя бы 10 неявок в месяц — подписка отбивается раньше, чем вы успеете поспорить о прайсе.',
      })
    }
  } else if (barePrice && !priceWithEconomics && (discoveryCount > 0 || textHasDiscovery)) {
    // Вилка названа без связки с потерями — это возраженческий провал, не «презентация»
    scores.objections -= 1.4
    comments.objections =
      'Цифру назвали, но не привязали к окупаемости на потерях клиники.'
    pushMistake({
      stageId: 'objections',
      weight: 3.5,
      managerQuote: truncateQuote(barePrice),
      comment:
        'Вилка цены без экономики клиента звучит как прайс-лист. РОП ждёт связку: потери в ₽ → окупаемость подписки.',
      betterScript:
        'Подписка 3–5 тыс. ₽/мес. Если у вас 50–100 тыс. потерь на неявках — она отбивается за неделю. Давайте сверю с вашей цифрой и сразу слот на 10 минут завтра.',
    })
    insights.push({
      id: 'price_without_roi',
      label: 'Цена без экономики (−objections)',
      deltaTotal: -0.3,
    })
  }

  if (facedExplicitObjection || barePrice) {
    if (count(intentLog, competitorIds) > 0 && discoveryCount === 0) {
      scores.objections -= 1.0
      pushMistake({
        stageId: 'objections',
        weight: 2,
        managerQuote: quoteFrom(intentLog, competitorIds, messages),
        comment:
          'Ушли в конкурентов без своей ценности. Сравнение без критериев — проигрыш по умолчанию.',
        betterScript:
          'Конкурентов знаю. Критерий простой: кто закрывает ваши конкретные потери на записи и повторных визитах за 30 дней. Давайте сверим по этим двум пунктам, а не по списку галочек.',
      })
    } else if (count(intentLog, competitorIds) > 0) {
      scores.objections += 0.5
    }

    if (
      count(intentLog, doubtIds) > 0 &&
      firstClosing === -1 &&
      !textHasClose
    ) {
      scores.objections -= 0.5
      scores.closing -= 1.2
    }
  }

  // —— CLOSING ——
  if (textHasClose) {
    scores.closing += 3.0
    comments.closing =
      'Есть попытка зафиксировать следующий шаг — это обязательно для зачёта.'
    const closeQuote = quoteClose(messages, intentLog)
    const concreteSlot = messages.some((m) => hasExplicitDateTimeSlot(m))
    pushSuccess({
      stageId: 'closing',
      weight: 3,
      managerQuote: closeQuote,
      comment: concreteSlot
        ? 'Зафиксирован next step. Без этого звонок = разговор ни о чём.'
        : 'Размытый следующий шаг: дата и время встречи не зафиксированы.',
    })
    insights.push({
      id: 'has_closing',
      label: 'Есть next step',
      deltaTotal: 0.4,
    })
  } else if (messages.length >= 2) {
    scores.closing -= 1.8
    comments.closing =
      'Диалог оборван без слота. Для РОПа это автоматический незачёт этапа.'
    // Цитату closing: stamp → intent → последняя с Zoom/временем
    const closingPool = quotesForClosingWithFallback(intentLog, messages)
    const badCloseQuote =
      [...closingPool].reverse().find((m) => !looksLikeClosingProposal(m)) ||
      closingPool[0] ||
      (stagedLog
        ? STAGE_NO_QUOTE_PLACEHOLDER.closing
        : messages[messages.length - 1]!)
    if (
      isStagePlaceholder(badCloseQuote) ||
      !looksLikeClosingProposal(badCloseQuote)
    ) {
      pushMistake({
        stageId: 'closing',
        weight: 3.8,
        managerQuote: truncateQuote(badCloseQuote),
        comment: isStagePlaceholder(badCloseQuote)
          ? 'На этапе закрытия не было реплик менеджера — слот и next step не зафиксированы.'
          : 'Нет конкретного следующего шага: дата, формат (Zoom), кто подключается. «Подумайте» без слота = потерянная сделка.',
        betterScript:
          'Предлагаю конкретку: завтра 12:30 или 16:00 — 20 минут в Zoom, подключим главврача. Какой слот ставим? Я сразу пришлю ссылку в WhatsApp.',
      })
    }
    insights.push({
      id: 'no_closing',
      label: 'Нет закрытия',
      deltaTotal: -0.5,
    })
  }

  // Soft / fuzzy next step без дня+времени → потолок 6.0
  {
    const concreteSlot = messages.some((m) => hasExplicitDateTimeSlot(m))
    const fuzzyClose =
      !concreteSlot &&
      (messages.some((m) => isFuzzyNextStep(m)) || textHasClose)
    if (fuzzyClose && messages.length >= 1) {
      scores.closing = Math.min(scores.closing, 6.0)
      comments.closing =
        'Размытый следующий шаг: дата и время встречи не зафиксированы.'
      if (!insights.some((i) => i.id === 'FUZZY_NEXT_STEP')) {
        insights.push({
          id: 'FUZZY_NEXT_STEP',
          label: 'Fuzzy next step (−closing ≤ 6)',
          deltaTotal: -0.2,
        })
      }
    }
  }

  // —— РАЗВЁРНУТАЯ АРГУМЕНТАЦИЯ ——
  const developedArgCount = count(intentLog, ['developed_argument'])
  const longMessages = messages.filter(
    (m) => isDevelopedArgument(m) && !isIntroGreeting(m),
  )
  if (developedArgCount > 0 || longMessages.length > 0) {
    const sample =
      longMessages.find((m) => hasPrice(m) && hasLossOrPain(m)) ||
      longMessages.find((m) => hasLossOrPain(m)) ||
      longMessages.find(hasPitch) ||
      quoteFrom(
        intentLog,
        ['developed_argument'],
        messages,
        messages.findIndex((m) => isDevelopedArgument(m) && !isIntroGreeting(m)),
      ) ||
      longMessages[0]
    if (sample && !isIntroGreeting(sample)) {
      const stage: StageId = hasPrice(sample)
        ? 'objections'
        : hasPitch(sample)
          ? 'presentation'
          : hasLossOrPain(sample)
            ? 'discovery'
            : 'objections'
      scores[stage] += 1.0
      pushSuccess({
        stageId: stage,
        weight: 4,
        managerQuote: sample,
        comment:
          'Менеджер подробно раскрыл ценность/преимущества, что снизило сопротивление клиента.',
        tag: 'strong_argument',
      })
      insights.push({
        id: 'developed_argument',
        label: 'Сильная аргументация (>150 симв., осмысленный текст)',
        deltaTotal: 0.3,
      })
    }
  }

  // —— Объём диалога ——
  if (messages.length === 1) {
    for (const id of STAGE_IDS) scores[id] -= 0.8
    insights.push({
      id: 'short_chat',
      label: 'Слишком короткий диалог',
      deltaTotal: -0.6,
    })
  } else if (messages.length >= 4 && !aggressive) {
    scores.contact += 0.3
  }

  // Гарантия ≥2 ошибок: добираем из слабых реплик (уникальные советы + не интро)
  const uniqueMistakes = dedupeMistakes(mistakes).sort((a, b) => b.weight - a.weight)

  while (uniqueMistakes.length < 2 && messages.length > 0) {
    const used = new Set(uniqueMistakes.map((m) => m.managerQuote))
    const candidate =
      messages.find(
        (m) =>
          !used.has(truncateQuote(m)) &&
          isTooShort(m) &&
          !isIntroGreeting(m) &&
          !containsNextStepKeywords(m) &&
          !containsProfanity(m),
      ) ||
      messages.find(
        (m) =>
          !used.has(truncateQuote(m)) &&
          hasPitch(m) &&
          !hasLossOrPain(m) &&
          !isIntroGreeting(m) &&
          !containsNextStepKeywords(m),
      ) ||
      messages.find(
        (m) =>
          !used.has(truncateQuote(m)) &&
          hasPrice(m) &&
          !hasLossOrPain(m) &&
          !containsNextStepKeywords(m),
      ) ||
      messages.find(
        (m) =>
          !used.has(truncateQuote(m)) &&
          !isIntroGreeting(m) &&
          !containsNextStepKeywords(m) &&
          !containsGreetingKeywords(m),
      ) ||
      messages.find(
        (m) =>
          !used.has(truncateQuote(m)) &&
          !containsNextStepKeywords(m) &&
          !containsProfanity(m),
      )

    if (!candidate) break

    if (uniqueMistakes.some((m) => m.managerQuote === truncateQuote(candidate))) {
      break
    }

    // Строгая классификация filler-цитаты — без случайного stage
    const parsed = validateAndClassifyQuote(candidate)
    if (parsed.type === 'SUCCESS') {
      // Next step / greeting не кладём в ошибки
      break
    }
    uniqueMistakes.push({
      weight: 1,
      stageId: parsed.stageId,
      managerQuote: truncateQuote(candidate),
      comment:
        parsed.whyBad ??
        'Реплика не двигает этап продажи по правилам разбора.',
      betterScript:
        parsed.howToFix ??
        'Уточните боль клиента вопросом и предложите конкретный next step.',
    })
  }

  if (messages.length === 0) {
    uniqueMistakes.length = 0
    uniqueMistakes.push(
      {
        weight: 5,
        stageId: 'contact',
        managerQuote: '—',
        comment:
          'Менеджер не произнёс ни одной рабочей реплики. Разбор невозможен без фактуры.',
        betterScript:
          'Добрый день, удобно 8 минут? Хочу понять, теряете ли вы записи на приём, и если да — предложить короткий разбор на демо.',
      },
      {
        weight: 5,
        stageId: 'closing',
        managerQuote: '—',
        comment:
          'Без диалога нет next step. Пересдача обязательна.',
        betterScript:
          'Давайте сразу слот: завтра 12:30 Zoom, 20 минут. Подтвердите — вышлю ссылку.',
      },
    )
  }

  // После сборки: слабый этап возражений — обязана быть красная карточка
  {
    const objScore = scores.objections
    const hasObjMistake = uniqueMistakes.some((m) => m.stageId === 'objections')
    if (
      objScore < 7 &&
      !hasObjMistake &&
      !insufficientData.has('objections')
    ) {
      let roiQuote: string | undefined
      if (stagedLog) {
        const objQuotes = quotesForFeedbackStage(intentLog, 'objections')
        roiQuote =
          objQuotes.find(isRoiOrPriceHandle) ||
          objQuotes.find((m) => hasPrice(m)) ||
          objQuotes.find((m) => /кресл|окуп|подписк/i.test(m)) ||
          objQuotes[0]
        if (!roiQuote) {
          roiQuote = STAGE_NO_QUOTE_PLACEHOLDER.objections
        }
      } else {
        roiQuote =
          messages.find(isRoiOrPriceHandle) ||
          messages.find((m) => hasPrice(m)) ||
          messages.find((m) => /кресл|окуп|подписк/i.test(m)) ||
          messages[messages.length - 1]
      }
      if (roiQuote) {
        uniqueMistakes.unshift({
          weight: 3,
          stageId: 'objections',
          managerQuote: truncateQuote(roiQuote),
          comment: isStagePlaceholder(roiQuote)
            ? 'На этапе возражений не было реплик менеджера — экономику окупаемости не зафиксировали.'
            : 'Этап возражений просел: не хватило жёсткой экономики «неявка × частота → окупаемость подписки».',
          betterScript:
            'Для двух кресел: один сорванный приём ≈ 2–3 тыс. ₽. Два возвращённых визита в месяц уже бьют подписку. Сверим с вашими цифрами — и сразу слот.',
        })
      }
    }
  }
  uniqueMistakes.sort((a, b) => b.weight - a.weight)

  let finalSuccesses: FeedbackSuccess[] = dedupeSuccesses(successes)
    .sort((a, b) => b.weight - a.weight)
    .map(({ stageId, managerQuote, comment, tag }) => ({
      stageId,
      managerQuote,
      comment,
      tag,
    }))

  const mistakeQuotes = new Set(
    uniqueMistakes.slice(0, 4).map((m) => m.managerQuote),
  )
  finalSuccesses = dedupeByQuote(finalSuccesses).filter(
    (s) => !mistakeQuotes.has(s.managerQuote),
  )

  // Интро-приветствие — ранняя реплика с представлением → успех контакта
  const intro =
    earlyContact?.text &&
    (earlyContact.hasValidIntroduction ||
      earlyContact.fullSetup ||
      isIntroGreeting(earlyContact.text))
      ? earlyContact.text
      : messages[0] && isIntroGreeting(messages[0])
        ? messages[0]
        : undefined
  if (intro) {
    const q = truncateQuote(intro)
    for (let i = uniqueMistakes.length - 1; i >= 0; i--) {
      if (
        uniqueMistakes[i]!.managerQuote === q &&
        uniqueMistakes[i]!.stageId === 'presentation'
      ) {
        uniqueMistakes.splice(i, 1)
      }
    }
    if (!finalSuccesses.some((s) => s.managerQuote === q)) {
      finalSuccesses.unshift({
        stageId: 'contact',
        managerQuote: q,
        comment:
          'Есть вход в контакт: представление и цель звонка. Это база установления контакта.',
      })
    }
  }

  const finalMistakes: FeedbackMistake[] = uniqueMistakes
    .slice(0, 4)
    .map(({ stageId, managerQuote, comment, betterScript, tag }) => ({
      stageId,
      managerQuote,
      comment,
      betterScript,
      tag,
    }))

  finalSuccesses = finalSuccesses.slice(0, 3)

  // Soft presentation: ценность не должна вытесняться лимитом top-3 (contact/discovery/closing).
  // Интеграция поверх МИС — карточка objections, не дублируем ту же цитату в presentation.
  if (
    softHasProductValue &&
    !finalSuccesses.some((s) => s.stageId === 'presentation')
  ) {
    const pitchQuote =
      softPitchQuotes.find(
        (q) =>
          q &&
          !isStagePlaceholder(q) &&
          !isIntegrationPitch(q) &&
          !isFullReplacementPitch(q),
      ) ||
      messages.find(
        (m) =>
          hasProductValueMention(m) &&
          !isIntegrationPitch(m) &&
          !isFullReplacementPitch(m),
      )
    if (pitchQuote) {
      const card: FeedbackSuccess = {
        stageId: 'presentation',
        managerQuote: truncateQuote(pitchQuote),
        comment: whyWorkedForStage('presentation'),
      }
      const dropIdx = finalSuccesses.findIndex((s) => s.stageId === 'discovery')
      if (dropIdx >= 0) {
        finalSuccesses.splice(dropIdx, 1, card)
      } else if (finalSuccesses.length < 3) {
        finalSuccesses.push(card)
      } else {
        finalSuccesses[finalSuccesses.length - 1] = card
      }
    }
  }

  if (finalSuccesses.length === 0 && messages.length > 0) {
    const best =
      messages.find((m) => hasClose(m)) ||
      messages.find((m) => hasQuestion(m) && hasLossOrPain(m)) ||
      messages.find((m) => hasQuestion(m)) ||
      messages.find((m) => normalize(m).length >= 50) ||
      messages[0]!
    const parsedBest = validateAndClassifyQuote(best)
    finalSuccesses = [
      {
        stageId: parsedBest.stageId,
        managerQuote: truncateQuote(best),
        comment:
          parsedBest.comment ??
          'Единственный относительно рабочий фрагмент. Этого мало для зачёта, но приём зафиксирован.',
      },
    ]
  }

  // Rule-based realign: дедуп + этика (stage уже из FSM)
  {
    const aligned = realignQuoteCards({
      mistakes: finalMistakes,
      successes: finalSuccesses,
    })
    finalMistakes.length = 0
    finalMistakes.push(...aligned.mistakes.slice(0, 6))
    finalSuccesses = aligned.successes.slice(0, 3)
  }

  // Legacy post-hoc remap — только если stage не проставлен в логе
  if (!stagedLog) {
    // Потери в ₽ не на contact; closing+Zoom/слот оставляем closing
    for (const m of finalMistakes) {
      if (
        containsLossCalcKeywords(m.managerQuote) &&
        m.stageId === 'contact' &&
        !isClosingStage(m.managerQuote)
      ) {
        m.stageId = isPresentationStage(m.managerQuote)
          ? 'presentation'
          : 'discovery'
      }
    }
    for (const s of finalSuccesses) {
      if (
        containsLossCalcKeywords(s.managerQuote) &&
        s.stageId === 'contact' &&
        !isClosingStage(s.managerQuote)
      ) {
        s.stageId = isPresentationStage(s.managerQuote)
          ? 'presentation'
          : 'discovery'
      }
      if (s.stageId === 'discovery' && isClosingStage(s.managerQuote)) {
        s.stageId = 'closing'
      }
      if (
        s.stageId === 'discovery' &&
        isPresentationStage(s.managerQuote) &&
        !isClosingStage(s.managerQuote)
      ) {
        s.stageId = 'presentation'
      }
    }
  }

  // Любой этап < 7.0 (жёлтая/красная зона) → минимум одна карточка ОШИБКА
  {
    const usedQuotes = new Set(
      [
        ...finalMistakes.map((m) => normalizeQuoteKey(m.managerQuote)),
        ...finalSuccesses.map((s) => normalizeQuoteKey(s.managerQuote)),
      ].filter((k) => k && k !== '—' && !isStagePlaceholder(k)),
    )
    const weakFixes: FeedbackMistake[] = []
    // Сначала самые слабые этапы — им приоритет на живые цитаты
    const weakIds = STAGE_IDS.filter(
      (id) =>
        round1(scores[id]) < 7 &&
        !insufficientData.has(id) &&
        !finalMistakes.some((m) => m.stageId === id) &&
        // Soft-value / прыжок к слоту — не клеим ложный «нет реплик презентации»
        !(
          id === 'presentation' &&
          (softHasProductValue || clientJumpedToSlot)
        ),
    ).sort((a, b) => scores[a] - scores[b])

    for (const id of weakIds) {
      let quote: string | null = null

      if (stagedLog) {
        if (id === 'closing') {
          const closingHit = quotesForClosingWithFallback(
            intentLog,
            messages,
          ).find((c) => {
            const key = normalizeQuoteKey(c)
            return key && !usedQuotes.has(key) && !isStagePlaceholder(c)
          })
          quote = closingHit ?? STAGE_NO_QUOTE_PLACEHOLDER.closing
        } else if (id === 'presentation') {
          // СТРОГО: при soft-match ценности запрещён placeholder «нет реплик».
          const pitchHit = quotesForPresentationWithFallback(
            intentLog,
            messages,
          ).find((c) => {
            const key = normalizeQuoteKey(c)
            return key && !usedQuotes.has(key) && !isStagePlaceholder(c)
          })
          if (pitchHit) {
            quote = pitchHit
          } else if (clientJumpedToSlot) {
            // Нет смысла штрафовать пустым placeholder — этап сжат клиентом.
            continue
          } else {
            quote = STAGE_NO_QUOTE_PLACEHOLDER.presentation
          }
        } else {
          const staged = quotesForFeedbackStage(intentLog, id).find((c) => {
            const key = normalizeQuoteKey(c)
            return key && !usedQuotes.has(key)
          })
          quote = staged ?? STAGE_NO_QUOTE_PLACEHOLDER[id]
        }
      } else {
        // CONTACT_SETUP: только Turn 1 — без reverse-scan по всему диалогу
        const candidates =
          id === 'contact'
            ? ([pickQuoteForWeakStage(id, messages)].filter(Boolean) as string[])
            : ([
                pickQuoteForWeakStage(id, messages),
                ...messages.slice().reverse(),
              ].filter(Boolean) as string[])

        for (const c of candidates) {
          const key = normalizeQuoteKey(c)
          if (!key || key === '—') continue
          if (usedQuotes.has(key)) continue
          if (
            (id === 'contact' || id === 'closing') &&
            containsLossCalcKeywords(c)
          ) {
            continue
          }
          if (id === 'contact' && isDiscoveryDiagnosticQuote(c)) continue
          if (
            id === 'contact' &&
            (isClosingStage(c) || containsNextStepKeywords(c))
          ) {
            continue
          }
          if (id === 'contact' && quoteTurnIndex(c, messages) > 0) continue
          if (
            containsLossCalcKeywords(c) &&
            id !== 'discovery' &&
            id !== 'objections' &&
            !(
              id === 'presentation' &&
              /(crm|модул|функц|решени|систем)/i.test(c)
            )
          ) {
            continue
          }
          quote = c
          break
        }
      }

      if (!quote) continue
      usedQuotes.add(normalizeQuoteKey(quote))

      weakFixes.push({
        stageId: id,
        managerQuote: truncateQuote(quote),
        comment: isStagePlaceholder(quote)
          ? STAGE_NO_QUOTE_PLACEHOLDER[id]
          : weakStageErrorComment(id),
        betterScript: weakStageBetterScript(id, messages[0]),
      })
    }

    if (weakFixes.length > 0) {
      const merged = [...finalMistakes, ...weakFixes]
      const seen = new Set<string>()
      finalMistakes.length = 0
      for (const m of merged) {
        const raw = normalizeQuoteKey(m.managerQuote)
        const key = raw === '—' ? `—::${m.stageId}` : raw
        if (seen.has(key)) continue
        seen.add(key)
        finalMistakes.push(m)
      }
      finalMistakes.splice(Math.max(5, weakFixes.length + 2))
    }

    // Диагностику, ошибочно попавшую в contact ERROR → discovery SUCCESS
    // (только legacy без stage-stamp)
    if (!stagedLog) {
      for (let i = finalMistakes.length - 1; i >= 0; i--) {
        const m = finalMistakes[i]!
        if (m.stageId !== 'contact') continue
        if (!isDiscoveryDiagnosticQuote(m.managerQuote)) continue
        finalMistakes.splice(i, 1)
        if (
          !finalSuccesses.some(
            (s) =>
              normalizeQuoteKey(s.managerQuote) ===
              normalizeQuoteKey(m.managerQuote),
          )
        ) {
          finalSuccesses.unshift({
            stageId: 'discovery',
            managerQuote: m.managerQuote,
            comment:
              'Диагностический вопрос — «Выявление потребностей», не ошибка контакта.',
          })
        }
      }
    }

    // Contact betterScript всегда про первый ход
    for (const m of finalMistakes) {
      if (m.stageId === 'contact' && !isStagePlaceholder(m.managerQuote)) {
        m.betterScript = weakStageBetterScript('contact', messages[0])
      }
    }
  }

  // Глобальный дедуп: одна живая цитата — одна карточка; ERROR > SUCCESS
  {
    const errKeys = new Set(
      finalMistakes
        .filter((m) => {
          const k = normalizeQuoteKey(m.managerQuote)
          return k && k !== '—' && !isStagePlaceholder(m.managerQuote)
        })
        .map((m) => normalizeQuoteKey(m.managerQuote)),
    )
    finalSuccesses = finalSuccesses.filter(
      (s) => !errKeys.has(normalizeQuoteKey(s.managerQuote)),
    )

    const seenOk = new Set<string>()
    finalSuccesses = finalSuccesses.filter((s) => {
      const key = normalizeQuoteKey(s.managerQuote)
      if (!key || seenOk.has(key)) return false
      seenOk.add(key)
      return true
    })

    const seenErr = new Set<string>()
    const dedupedErr: FeedbackMistake[] = []
    for (const m of finalMistakes) {
      const raw = normalizeQuoteKey(m.managerQuote)
      const key =
        raw === '—' || isStagePlaceholder(m.managerQuote)
          ? `${raw}::${m.stageId}`
          : raw
      if (!key || seenErr.has(key)) continue
      // Legacy content remap — только без FSM stage
      if (!stagedLog) {
        if (
          containsLossCalcKeywords(m.managerQuote) &&
          m.stageId === 'contact' &&
          !isClosingStage(m.managerQuote)
        ) {
          m.stageId = isPresentationStage(m.managerQuote)
            ? 'presentation'
            : 'discovery'
        }
        if (isClosingStage(m.managerQuote) && m.stageId === 'discovery') {
          m.stageId = 'closing'
        }
        if (
          isPresentationStage(m.managerQuote) &&
          m.stageId === 'discovery' &&
          !isClosingStage(m.managerQuote)
        ) {
          m.stageId = 'presentation'
        }
      }
      seenErr.add(key)
      dedupedErr.push(m)
    }
    finalMistakes.length = 0
    finalMistakes.push(...dedupedErr)

    const weakStageIds = new Set(
      STAGE_IDS.filter(
        (id) => round1(scores[id]) < 7 && !insufficientData.has(id),
      ),
    )
    finalSuccesses = finalSuccesses.filter((s) => {
      // Интро-приветствие всегда остаётся на контакте — даже если этап < 7
      if (s.stageId === 'contact' && isIntroGreeting(s.managerQuote)) return true
      // Диагностика остаётся SUCCESS discovery — не путать с провалом контакта
      if (
        s.stageId === 'discovery' &&
        isDiscoveryDiagnosticQuote(s.managerQuote)
      ) {
        return true
      }
      if (!weakStageIds.has(s.stageId as StageId)) return true
      return finalMistakes.some(
        (m) =>
          m.stageId === s.stageId &&
          normalizeQuoteKey(m.managerQuote) !==
            normalizeQuoteKey(s.managerQuote),
      )
    })
  }

  // Финальный маппинг: greeting / раннее представление → contact; без пустых «—»
  {
    const intro =
      earlyContact?.text &&
      (earlyContact.hasValidIntroduction ||
        earlyContact.fullSetup ||
        isIntroGreeting(earlyContact.text))
        ? earlyContact.text
        : messages[0] && isIntroGreeting(messages[0])
          ? messages[0]
          : undefined
    const introTurn = intro ? quoteTurnIndex(intro, messages) : -1
    if (intro) {
      const q = truncateQuote(intro)
      // Снять intro greeting с presentation / других этапов ERROR
      for (let i = finalMistakes.length - 1; i >= 0; i--) {
        const m = finalMistakes[i]!
        if (
          normalizeQuoteKey(m.managerQuote) === normalizeQuoteKey(q) ||
          (isIntroGreeting(m.managerQuote) &&
            (quoteTurnIndex(m.managerQuote, messages) === introTurn ||
              quoteTurnIndex(m.managerQuote, messages) === 0))
        ) {
          finalMistakes.splice(i, 1)
        }
      }
      for (const s of finalSuccesses) {
        // Только точная цитата intro → contact; не трогаем presentation/closing
        if (normalizeQuoteKey(s.managerQuote) !== normalizeQuoteKey(q)) {
          continue
        }
        if (
          s.stageId === 'presentation' ||
          s.stageId === 'closing' ||
          s.stageId === 'discovery'
        ) {
          continue
        }
        s.stageId = 'contact'
        s.comment =
          'Есть вход в контакт: представление и цель звонка. Этап — только «Установление контакта».'
      }
      if (
        !finalSuccesses.some(
          (s) =>
            s.stageId === 'contact' &&
            normalizeQuoteKey(s.managerQuote) === normalizeQuoteKey(q),
        )
      ) {
        finalSuccesses.unshift({
          stageId: 'contact',
          managerQuote: q,
          comment:
            'Есть вход в контакт: представление и цель звонка. Этап — только «Установление контакта».',
        })
      }
    }

    if (messages.length > 0) {
      const liveMistakes = finalMistakes.filter(
        (m) => !isBlankQuote(m.managerQuote),
      )
      finalMistakes.length = 0
      finalMistakes.push(...liveMistakes)
      finalSuccesses = finalSuccesses.filter((s) => !isBlankQuote(s.managerQuote))
    }

    // Дедуп SUCCESS после принудительного contact
    const seenOk = new Set<string>()
    finalSuccesses = finalSuccesses.filter((s) => {
      const key = normalizeQuoteKey(s.managerQuote)
      if (!key || seenOk.has(key)) return false
      seenOk.add(key)
      return true
    })
  }

  // Sanity: CONTACT — ранняя рамка (не только Turn 1); CLOSING/NEXT_STEP ≠ contact
  // Legacy only: при FSM stage-stamp не перекидываем цитаты между этапами
  if (!stagedLog) {
    const contactTurnAllowed = new Set<number>(
      earlyContact ? [earlyContact.index] : messages.length > 0 ? [0] : [],
    )
    const isAllowedContactTurn = (turn: number) =>
      turn < 0 || contactTurnAllowed.has(turn)

    const rehomeContactCard = (
      quote: string,
    ): { stageId: StageId; comment: string } | null => {
      if (isClosingStage(quote) || containsNextStepKeywords(quote)) {
        return {
          stageId: 'closing',
          comment:
            'Зафиксирован конкретный следующий шаг и предлагается слот / канал связи.',
        }
      }
      if (isDiscoveryDiagnosticQuote(quote)) {
        return {
          stageId: 'discovery',
          comment:
            'Диагностический вопрос — этап «Выявление потребностей», не контакт.',
        }
      }
      if (isPresentationStage(quote)) {
        return {
          stageId: 'presentation',
          comment: 'Продуктовая формулировка — этап презентации, не контакт.',
        }
      }
      return null
    }

    // Снять с contact всё, что не ранняя рамка / closing bleed
    for (let i = finalMistakes.length - 1; i >= 0; i--) {
      const m = finalMistakes[i]!
      if (m.stageId !== 'contact') continue
      const turn = quoteTurnIndex(m.managerQuote, messages)
      const bleed =
        !isAllowedContactTurn(turn) ||
        isClosingStage(m.managerQuote) ||
        containsNextStepKeywords(m.managerQuote)
      if (!bleed && isAllowedContactTurn(turn)) continue
      if (!bleed && turn < 0) {
        if (
          !isClosingStage(m.managerQuote) &&
          !containsNextStepKeywords(m.managerQuote)
        ) {
          continue
        }
      }
      const home = rehomeContactCard(m.managerQuote)
      finalMistakes.splice(i, 1)
      if (home) {
        if (home.stageId === 'closing') {
          if (
            !finalSuccesses.some(
              (s) =>
                normalizeQuoteKey(s.managerQuote) ===
                normalizeQuoteKey(m.managerQuote),
            )
          ) {
            finalSuccesses.unshift({
              stageId: 'closing',
              managerQuote: m.managerQuote,
              comment: home.comment,
            })
          }
        } else if (
          !finalMistakes.some(
            (x) =>
              normalizeQuoteKey(x.managerQuote) ===
              normalizeQuoteKey(m.managerQuote),
          ) &&
          !finalSuccesses.some(
            (s) =>
              normalizeQuoteKey(s.managerQuote) ===
              normalizeQuoteKey(m.managerQuote),
          )
        ) {
          finalMistakes.push({
            stageId: home.stageId,
            managerQuote: m.managerQuote,
            comment: m.comment,
            betterScript: m.betterScript,
          })
        }
      }
    }

    for (let i = finalSuccesses.length - 1; i >= 0; i--) {
      const s = finalSuccesses[i]!
      if (s.stageId !== 'contact') continue
      const turn = quoteTurnIndex(s.managerQuote, messages)
      if (
        isAllowedContactTurn(turn) &&
        !isClosingStage(s.managerQuote) &&
        !containsNextStepKeywords(s.managerQuote)
      ) {
        continue
      }
      const home = rehomeContactCard(s.managerQuote)
      if (home) {
        s.stageId = home.stageId
        s.comment = home.comment
      } else if (!isAllowedContactTurn(turn)) {
        finalSuccesses.splice(i, 1)
      }
    }

    // Один stage bucket не смешивает ранний контакт и поздние реплики
    const stageTurns = new Map<string, Set<number>>()
    const note = (stageId: string, quote: string) => {
      const t = quoteTurnIndex(quote, messages)
      if (t < 0) return
      if (!stageTurns.has(stageId)) stageTurns.set(stageId, new Set())
      stageTurns.get(stageId)!.add(t)
    }
    for (const m of finalMistakes) note(m.stageId, m.managerQuote)
    for (const s of finalSuccesses) note(s.stageId, s.managerQuote)

    for (const [stageId, turns] of stageTurns) {
      if (turns.size <= 1) continue
      if (stageId !== 'contact') continue
      // Contact: оставить только ход с валидным представлением
      finalMistakes.splice(
        0,
        finalMistakes.length,
        ...finalMistakes.filter(
          (m) =>
            m.stageId !== 'contact' ||
            isAllowedContactTurn(quoteTurnIndex(m.managerQuote, messages)),
        ),
      )
      finalSuccesses = finalSuccesses.filter(
        (s) =>
          s.stageId !== 'contact' ||
          isAllowedContactTurn(quoteTurnIndex(s.managerQuote, messages)),
      )
    }
  }

  // Discovery: interrogative keywords ≠ «нет вопроса»
  {
    const noQ = /нет\s+вопроса|NO_QUESTION_FOUND|нет\s+диагностическ/i
    for (let i = finalMistakes.length - 1; i >= 0; i--) {
      const m = finalMistakes[i]!
      if (m.stageId !== 'discovery') continue
      if (!isQuestion(m.managerQuote)) continue
      if (!noQ.test(m.comment) && !noQ.test(m.betterScript ?? '')) continue
      // Вопрос есть — убираем ложный ERROR или переводим в SUCCESS
      finalMistakes.splice(i, 1)
      if (
        !finalSuccesses.some(
          (s) =>
            normalizeQuoteKey(s.managerQuote) ===
            normalizeQuoteKey(m.managerQuote),
        )
      ) {
        finalSuccesses.unshift({
          stageId: 'discovery',
          managerQuote: m.managerQuote,
          comment:
            'Диагностический вопрос клиенту (в т.ч. без «?» / с хвостовой пунктуацией).',
        })
      }
    }
  }

  // Полная / валидная рамка на раннем ходе → contact высокий, без сырого MISSING_FRAME
  if (
    !aggressive &&
    (earlyContact?.fullSetup ||
      (contactQuote && hasFullContactSetup(contactQuote)) ||
      hasValidIntroduction)
  ) {
    scores.contact = earlyContact?.fullSetup ||
      (contactQuote && hasFullContactSetup(contactQuote))
      ? 10
      : Math.max(scores.contact, 8)
    comments.contact =
      'Представление и цель звонка озвучены корректно.'
    for (let i = insights.length - 1; i >= 0; i--) {
      if (insights[i]!.id === 'MISSING_FRAME_ERROR') insights.splice(i, 1)
    }
  }

  // Pre-render: card_stage обязан совпадать с justification_stage
  {
    finalSuccesses = sanitizeQuoteJustifications(finalSuccesses)
    // ERROR-карточки тоже не тащат чужой why
    for (const m of finalMistakes) {
      if (
        (m.stageId === 'presentation' || m.stageId === 'closing') &&
        /диагностическ|выявление\s+потребност/i.test(m.comment)
      ) {
        m.comment =
          m.stageId === 'presentation'
            ? whyWorkedForStage('presentation')
            : whyWorkedForStage('closing')
      }
    }
  }

  // Clamp scores после hard-gate / штрафов
  for (const id of STAGE_IDS) {
    scores[id] = clamp(scores[id])
  }

  const stageScores: FeedbackStageScore[] = STAGE_IDS.map((id) => ({
    stageId: id,
    score: round1(scores[id]),
    comment: comments[id],
  }))

  // Штраф за ошибки в тотале
  let totalScore = round1(avg(stageScores.map((s) => s.score)))
  if (finalMistakes.length >= 3) {
    totalScore = round1(totalScore - 0.2)
  }

  // Бонус за полный цикл: контакт → discovery → ценность → слот
  const cycleComplete =
    messages.some((m) => /(здравств|добр|удобно)/i.test(m)) &&
    (discoveryCount >= 1 || textDiscoveryQs >= 1) &&
    textHasClose &&
    (textHasPitch || messages.some((m) => hasLossOrPain(m) && hasPitch(m)))
  if (cycleComplete && !aggressive && !priceBeforeDiscovery) {
    totalScore = round1(totalScore + 0.8)
    insights.push({
      id: 'full_cycle',
      label: 'Полный цикл продажи',
      deltaTotal: 0.8,
    })
  }

  if (messages.length === 0) {
    totalScore = 1.5
  }

  const verdict: Verdict = totalScore >= PASS_THRESHOLD ? 'passed' : 'retake'

  const weakest = [...stageScores].sort((a, b) => a.score - b.score)[0]!
  const mainRecommendation = buildMainRecommendation(weakest.stageId as StageId, verdict)

  const recommendations = [
    mainRecommendation,
    ...buildSecondaryRecs(stageScores),
  ].slice(0, 3)

  // Сухие комментарии к этапам — без воды
  for (const row of stageScores) {
    if (row.score < 5) {
      row.comment = `${row.comment} Оценка ниже стандарта отдела.`
    } else if (row.score >= 8) {
      row.comment = `${row.comment} Уровень близок к эталону.`
    }
  }

  return {
    feedback: {
      totalScore,
      stageScores,
      mistakes: finalMistakes,
      successes: finalSuccesses,
      recommendations,
      verdict,
      verdictLabel: verdict === 'passed' ? 'Пройдено' : 'Требуется пересдача',
      mainRecommendation,
    },
    insights,
  }
}

function dedupeMistakes(list: DraftMistake[]): DraftMistake[] {
  const seen = new Set<string>()
  const out: DraftMistake[] = []
  for (const m of list) {
    const key = m.managerQuote
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

function dedupeSuccesses(list: DraftSuccess[]): DraftSuccess[] {
  const seen = new Set<string>()
  const out: DraftSuccess[] = []
  for (const m of list) {
    const key = m.managerQuote
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

function dedupeByQuote<T extends { managerQuote: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const m of list) {
    if (seen.has(m.managerQuote)) continue
    seen.add(m.managerQuote)
    out.push(m)
  }
  return out
}

function buildMainRecommendation(weakest: StageId, verdict: Verdict): string {
  const prefix =
    verdict === 'retake'
      ? 'Пересдача. '
      : 'Допуск есть, но стандарт не закрыт. '

  switch (weakest) {
    case 'discovery':
      return `${prefix}До продукта — минимум 3 вопроса: потери заявок, роль администратора, повторные визиты. Без цифр потерь на демо не выходите.`
    case 'objections':
      return `${prefix}На «дорого» только экономика: неявка × частота × месяц. Скидки и оправдания запрещены.`
    case 'closing':
      return `${prefix}Каждый диалог заканчивается слотом: дата + Zoom/WhatsApp + кто на созвоне. Иначе тренировка не засчитана.`
    case 'presentation':
      return `${prefix}Презентуйте 1–2 модуля под подтверждённую боль. Каталог функций — провал этапа.`
    case 'contact':
    default:
      return `${prefix}С первых фраз фиксируйте рамку: кто вы, зачем звонок, сколько минут, какой критерий успеха разговора.`
  }
}

function buildSecondaryRecs(stages: FeedbackStageScore[]): string[] {
  const sorted = [...stages].sort((a, b) => a.score - b.score)
  const recs: string[] = []
  for (const s of sorted.slice(0, 2)) {
    if (s.stageId === 'discovery') {
      recs.push(
        'Запрет: цена и демо до трёх диагностических вопросов о процессе клиники.',
      )
    } else if (s.stageId === 'closing') {
      recs.push(
        'На «подумаю» сразу альтернатива слотов. Пауза без даты = потеря.',
      )
    } else if (s.stageId === 'objections') {
      recs.push(
        'Возражение переводите в критерий выбора, не в спор о продукте.',
      )
    } else if (s.stageId === 'presentation') {
      recs.push(
        'Формула питча: «если боль X — смотрим блок Y». Остальное вырезайте.',
      )
    } else {
      recs.push(
        'Удерживайте повестку: каждая реплика либо диагностика, либо next step.',
      )
    }
  }
  return recs
}

function pickQuoteForWeakStage(id: StageId, messages: string[]): string | null {
  if (messages.length === 0) return null
  if (id === 'contact') {
    // Раннее представление (не обязательно Turn 1); никогда поздние Zoom/слот/диагностика
    const hit = findEarlyContactIntroduction(messages)
    const first = hit?.text ?? messages[0]!
    if (isClosingStage(first) || containsNextStepKeywords(first)) return null
    if (isDiscoveryDiagnosticQuote(first) && !hasIntroductionSignals(first)) {
      return null
    }
    if (
      hasIntroductionSignals(first) ||
      isContactFrameQuote(first) ||
      containsGreetingKeywords(first)
    ) {
      return first
    }
    if (!isQuestion(first)) return first
    return null
  }
  if (id === 'discovery') {
    return (
      messages.find((m) => isDiscoveryDiagnosticQuote(m)) ||
      messages.find((m) => containsLossCalcKeywords(m)) ||
      messages.find((m) => hasQuestion(m) && hasLossOrPain(m)) ||
      messages.find((m) => hasQuestion(m)) ||
      messages.find(hasLossOrPain) ||
      null
    )
  }
  if (id === 'presentation') {
    return (
      messages.find((m) => hasProductValueMention(m) && !isIntroGreeting(m)) ||
      messages.find((m) => hasPitch(m) && !isIntroGreeting(m)) ||
      messages.find(
        (m) =>
          !isIntroGreeting(m) &&
          containsLossCalcKeywords(m) &&
          /(crm|решени|систем)/i.test(m),
      ) ||
      messages.find(
        (m) =>
          !isIntroGreeting(m) &&
          m.length > 50 &&
          !containsLossCalcKeywords(m) &&
          !containsGreetingKeywords(m),
      ) ||
      null
    )
  }
  if (id === 'objections') {
    return (
      messages.find(isRoiOrPriceHandle) ||
      messages.find(hasPrice) ||
      messages.find((m) => /кресл|окуп|подписк|дорого/i.test(m)) ||
      null
    )
  }
  if (id === 'closing') {
    return (
      [...messages]
        .reverse()
        .find(
          (m) =>
            !containsNextStepKeywords(m) &&
            !containsLossCalcKeywords(m) &&
            !containsGreetingKeywords(m),
        ) || null
    )
  }
  return null
}

function weakStageErrorComment(id: StageId): string {
  switch (id) {
    case 'contact':
      return 'Контакт ниже стандарта: слабая рамка роли/цели звонка.'
    case 'discovery':
      return 'Выявление потребностей просело: мало диагностических вопросов и цифр потерь.'
    case 'presentation':
      return 'Презентация слабая: решение не привязано жёстко к боли клиники.'
    case 'objections':
      return 'Работа с возражениями ниже 7.0: нет убедительной экономики «неявка → окупаемость».'
    case 'closing':
      return 'Закрытие слабое: next step без конкретной даты/канала или сорван.'
    default:
      return 'Этап ниже порога 7.0 — нужна пересдача по этому блоку.'
  }
}

function weakStageBetterScript(id: StageId, firstTurn?: string): string {
  switch (id) {
    case 'contact':
      // «Как сказать правильно» — про первый ход, не про позднюю диагностику
      if (firstTurn && isDiscoveryDiagnosticQuote(firstTurn)) {
        return 'На первом ходе сначала рамка: «Добрый день, это [Имя], ДентаCRM. Удобно 2 минуты? Цель — понять потери на записи». Диагностику («кто ведёт запись…») — следующим сообщением.'
      }
      return 'Добрый день, ДентаCRM. Удобно 8 минут? Цель — понять потери на записи и решить, нужен ли короткий разбор.'
    case 'discovery':
      return 'Сколько заявок из WhatsApp не доходит до записи за неделю? Кто дожимает — администратор или вы?'
    case 'presentation':
      return 'Если боль в неявках — смотрим автонапоминания и контроль окон. Остальное не трогаем на первом созвоне.'
    case 'objections':
      return 'Одна неявка ≈ X ₽. 10 возвращённых визитов в месяц уже бьют подписку. Сверим с вашей цифрой — и слот.'
    case 'closing':
      return 'Завтра 12:30 Zoom, 15 минут. Подтвердите — вышлю ссылку в WhatsApp.'
    default:
      return 'Зафиксируйте боль в цифрах и сразу предложите слот.'
  }
}

/** Совместимость со старым API feedbackScore */
export function buildDynamicFeedback(
  _base: FeedbackResult,
  intentLog: IntentLogItem[],
  managerMessages: string[],
): { feedback: FeedbackResult; insights: ScoreInsight[] } {
  return analyzeRoleplayFeedback({ managerMessages, intentLog })
}
