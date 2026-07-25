/**
 * Rule-based helpers for feedback quotes (no LLM).
 *
 * Stage assignment for report cards comes from FSM stamps on intentLog —
 * `validateAndClassifyQuote` is a legacy/standalone classifier for smoke
 * and unstaged sessions, not the primary card mapper.
 */

import {
  howToFixForRule,
  howToFixForStage,
  isClosingStage,
  isContactFrameQuote,
  isDiscoveryDiagnosticQuote,
  isDiscoveryQuestion,
  isPresentationStage,
  isQuestion,
  matchStagePriority,
  RULE_WHY_BAD,
  type StageRuleId,
} from './stageMatcher'
import { ABUSE_REGEX, containsAbuse } from './abuseDetect'

export {
  isQuestion,
  normalizeQuestionText,
  isDiscoveryDiagnosticQuote,
  isContactFrameQuote,
} from './stageMatcher'

export type ReportStageLabel =
  | 'Установление контакта'
  | 'Выявление потребностей'
  | 'Презентация'
  | 'Работа с возражениями'
  | 'Завершение сделки'
  | 'Этика'

export type ReportStageId =
  | 'contact'
  | 'discovery'
  | 'presentation'
  | 'objections'
  | 'closing'

export type ParsedFeedback = {
  quote: string
  stage: ReportStageLabel
  stageId: ReportStageId
  type: 'SUCCESS' | 'ERROR'
  ruleId?: StageRuleId
  whyBad?: string
  howToFix?: string
  comment?: string
}

/** Rule A — мат / хамство / агрессия (общий детектор) */
export const IS_PROFANITY_REGEX = ABUSE_REGEX

/**
 * Rule B.1 — next step / слот / Zoom CTA.
 * Closing побеждает loss-keywords (см. isClosingStage).
 */
export const NEXT_STEP_KEYWORDS =
  /(?:\b(?:в|на)\s*)?(?:[01]?\d|2[0-3])\s*[:.]\s*[0-5]\d(?:\s*или\s*(?:в\s*)?(?:[01]?\d|2[0-3])\s*[:.]\s*[0-5]\d)?|(?:в\s*)?(?:11|12|13|14|15|16|17)\s*или\s*(?:в\s*)?(?:11|12|13|14|15|16|17)\b|включаемся\s+в\s*(?:zoom|зуум)|созвонимся\s+(?:завтра|сегодня|послезавтра)|давайте\s+(?:завтра|сегодня|послезавтра).{0,48}(?:zoom|зуум|слот|созвон|демо)|(?:слот|демо|созвон)\s+(?:на\s+)?\d{1,2}\s*мин|назначим\s+(?:демо|созвон|встреч)|пришлю\s+ссылк|ссылк\w*\s+в\s*(?:whatsapp|ватсап|вотсап)|следующ(?:ий|им)\s+шаг|(?:\bzoom\b|зуум)/i

/** Rule B.2 — greeting / intro */
export const GREETING_KEYWORDS =
  /(добрый\s+день|добрый\s+вечер|доброе\s+утро|здравствуй|меня\s+зовут|компани[яи]|звоню\s+по|удобно\s+(ли\s+)?(\d+\s+)?(говорить|минут)|это\s+[a-zа-я][a-zа-я\d-]{1,24}.{0,48}(crm|компани|дента))/i

/** Rule B.3 — metrics / finance / losses */
export const FINANCE_KEYWORDS =
  /(руб|₽|выручк|потер|теря|упуска|неявк|окупаем|roi|филиал|кресл|подписк|прайс|бюджет|стоим|тариф|тыс\.?|заявк)/i

/** Потери / ROI-расчёт — сами по себе не закрытие */
export const LOSS_CALC_KEYWORDS =
  /(упуска|потер|теря|недополуча|выручк|неявк|заявк\w*.{0,40}(?:руб|₽|тыс|\d)|(?:\d+[^\d]{0,12}\d+).{0,12}(?:руб|₽|тыс)|чеке?\s+\d)/i

const LABEL_TO_ID: Record<ReportStageLabel, ReportStageId> = {
  'Установление контакта': 'contact',
  'Выявление потребностей': 'discovery',
  Презентация: 'presentation',
  'Работа с возражениями': 'objections',
  'Завершение сделки': 'closing',
  Этика: 'contact',
}

const ID_TO_LABEL: Record<ReportStageId, ReportStageLabel> = {
  contact: 'Установление контакта',
  discovery: 'Выявление потребностей',
  presentation: 'Презентация',
  objections: 'Работа с возражениями',
  closing: 'Завершение сделки',
}

export function stageLabelToId(label: ReportStageLabel): ReportStageId {
  return LABEL_TO_ID[label]
}

export function stageIdToLabel(id: ReportStageId): ReportStageLabel {
  return ID_TO_LABEL[id]
}

export function normalizeQuoteKey(quote: string): string {
  return quote.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function containsProfanity(quote: string): boolean {
  return containsAbuse(quote)
}

/** «в 11:00 или в 15:00», «включаемся в Zoom», «завтра в 11 Zoom». */
export function isExplicitSlotProposal(quote: string): boolean {
  return isClosingStage(quote)
}

/**
 * Явный слот / Zoom / CTA. Closing priority: loss keywords НЕ блокируют.
 */
export function containsNextStepKeywords(quote: string): boolean {
  return isClosingStage(quote) || NEXT_STEP_KEYWORDS.test(quote)
}

export function containsGreetingKeywords(quote: string): boolean {
  return GREETING_KEYWORDS.test(quote.toLowerCase().replace(/ё/g, 'е'))
}

export function containsFinanceKeywords(quote: string): boolean {
  return FINANCE_KEYWORDS.test(quote.toLowerCase().replace(/ё/g, 'е'))
}

export function containsLossCalcKeywords(quote: string): boolean {
  return LOSS_CALC_KEYWORDS.test(quote.toLowerCase().replace(/ё/g, 'е'))
}

export function containsPresentationFeatures(quote: string): boolean {
  return isPresentationStage(quote)
}

export function financeSubStage(quote: string): ReportStageLabel {
  // Closing / presentation всегда выше finance→discovery
  const prioritized = matchStagePriority(quote)
  if (prioritized) {
    return stageIdToLabel(prioritized.stageId)
  }

  const t = quote.toLowerCase().replace(/ё/g, 'е')
  if (
    /(дорого|окуп|roi|подписк|прайс|вилк|бюджет)/i.test(t) &&
    !/(упуска|потер|заявк|неявк)/i.test(t)
  ) {
    return 'Работа с возражениями'
  }
  if (LOSS_CALC_KEYWORDS.test(t) || /(упуска|потер|теря|заявк|неявк|выручк)/i.test(t)) {
    // Без вопроса — не «успешный discovery», только value/finance рамка
    if (isDiscoveryQuestion(quote)) return 'Выявление потребностей'
    if (isPresentationStage(quote)) return 'Презентация'
    return 'Выявление потребностей'
  }
  if (/(crm|модул|функц|интеграц|дашборд|аналитик)/i.test(t)) {
    return 'Презентация'
  }
  return 'Выявление потребностей'
}

export function financeSubStageId(quote: string): ReportStageId {
  return stageLabelToId(financeSubStage(quote))
}

/** Эталонные why_worked / justification по этапу карточки. */
export function whyWorkedForStage(stageId: string): string {
  switch (stageId) {
    case 'contact':
      return 'Есть вход в контакт: приветствие / представление. Этап — только «Установление контакта».'
    case 'discovery':
      return 'Диагностический вопрос клиенту — этап «Выявление потребностей».'
    case 'presentation':
      return 'Презентация выгоды привязана к озвученной боли клиента.'
    case 'objections':
      return 'Возражение закрыто экономикой / ответом по сути — этап отработан.'
    case 'closing':
      return 'Зафиксирован конкретный следующий шаг и предлагается слот / канал связи.'
    default:
      return 'Рабочий приём зафиксирован по этапу продажи.'
  }
}

/** Эвристика: justification ссылается на другой этап, чем card.stageId. */
export function justificationMismatchesStage(
  stageId: string,
  comment: string | undefined,
): boolean {
  const c = (comment ?? '').toLowerCase()
  if (!c.trim()) return true

  const refsDiscovery =
    /диагностическ|выявление\s+потребност/i.test(c)
  const refsContact =
    /вход\s+в\s+контакт|установление\s+контакта|приветствие\s*\/\s*представление/i.test(
      c,
    )
  const refsClosing =
    /следующий\s+шаг|слот\s*\/\s*канал|завершение\s+сделк/i.test(c)
  const refsPresentation =
    /презентац|фича|выгод|привязан|связк|решени|питч|продуктов/i.test(c)
  const refsObjections =
    /возражен|экономик/i.test(c)

  switch (stageId) {
    case 'presentation':
      return refsDiscovery || refsContact || (refsClosing && !refsPresentation)
    case 'closing':
      return refsDiscovery || refsContact || (refsPresentation && !refsClosing)
    case 'contact':
      return refsDiscovery || refsPresentation || refsClosing
    case 'discovery':
      return refsContact || refsPresentation || refsClosing
    case 'objections':
      return refsDiscovery && !refsObjections
    default:
      return false
  }
}

/**
 * Pre-render: если card_stage ≠ justification_stage — подставить шаблон этапа.
 */
export function sanitizeQuoteJustifications<
  T extends { stageId: string; comment?: string; managerQuote?: string },
>(cards: T[]): T[] {
  return cards.map((card) => {
    if (!justificationMismatchesStage(card.stageId, card.comment)) {
      return card
    }
    return {
      ...card,
      comment: whyWorkedForStage(card.stageId),
    }
  })
}

/**
 * Строгая классификация одной цитаты менеджера.
 */
export function validateAndClassifyQuote(quote: string): ParsedFeedback {
  const q = quote.replace(/\s+/g, ' ').trim()

  if (containsProfanity(q)) {
    return {
      quote: q,
      stage: 'Этика',
      stageId: 'contact',
      type: 'ERROR',
      ruleId: 'RULE_ETHICS',
      whyBad: 'Разговор сорван из-за нарушения деловой этики',
      howToFix: undefined,
      comment: 'Разговор сорван из-за нарушения деловой этики',
    }
  }

  // 1) CLOSING — Zoom / слот / CTA, даже при «потери» / «рублей»
  if (isClosingStage(q) || containsNextStepKeywords(q)) {
    return {
      quote: q,
      stage: 'Завершение сделки',
      stageId: 'closing',
      type: 'SUCCESS',
      ruleId: 'RULE_CLOSING_SLOT',
      comment:
        'Зафиксирован конкретный следующий шаг и предлагается слот / канал связи.',
      howToFix: howToFixForRule('RULE_CLOSING_SLOT'),
    }
  }

  // 2) PRESENTATION — продуктовые фичи (выше discovery: «Как раз… подключаем автобота»)
  if (isPresentationStage(q)) {
    const tiedToPain =
      containsLossCalcKeywords(q) ||
      /(потер|неявк|заявк|боль|админ|для\s+этого)/i.test(q)
    return {
      quote: q,
      stage: 'Презентация',
      stageId: 'presentation',
      type: tiedToPain ? 'SUCCESS' : 'ERROR',
      ruleId: 'RULE_PRESENTATION_FEATURES',
      comment: tiedToPain
        ? 'Презентация выгоды привязана к озвученной боли клиента.'
        : 'Фичи без боли клиента — слабая презентация.',
      whyBad: tiedToPain ? undefined : RULE_WHY_BAD.RULE_PRESENTATION_FEATURES,
      howToFix: howToFixForRule('RULE_PRESENTATION_FEATURES'),
    }
  }

  // 3) DISCOVERY — диагностический вопрос (не в CONTACT_SETUP / не presentation)
  if (isDiscoveryDiagnosticQuote(q)) {
    return {
      quote: q,
      stage: 'Выявление потребностей',
      stageId: 'discovery',
      type: 'SUCCESS',
      ruleId: 'RULE_DISCOVERY_QUESTION',
      comment:
        'Диагностический вопрос клиенту — этап «Выявление потребностей».',
      howToFix: howToFixForRule('RULE_DISCOVERY_QUESTION'),
    }
  }

  // 4) Greeting / intro — только рамка контакта (не closing/next-step)
  if (
    (containsGreetingKeywords(q) || isContactFrameQuote(q)) &&
    !isClosingStage(q) &&
    !containsNextStepKeywords(q)
  ) {
    return {
      quote: q,
      stage: 'Установление контакта',
      stageId: 'contact',
      type: 'SUCCESS',
      ruleId: 'RULE_GREETING',
      comment:
        'Есть вход в контакт: приветствие / представление. Этап — только «Установление контакта».',
      howToFix: howToFixForRule('RULE_GREETING'),
    }
  }

  // 5) DISCOVERY — общий вопрос (fallback)
  if (isDiscoveryQuestion(q) || isQuestion(q)) {
    return {
      quote: q,
      stage: 'Выявление потребностей',
      stageId: 'discovery',
      type: 'SUCCESS',
      ruleId: 'RULE_DISCOVERY_QUESTION',
      comment:
        'Диагностический вопрос клиенту — этап «Выявление потребностей».',
      howToFix: howToFixForRule('RULE_DISCOVERY_QUESTION'),
    }
  }

  // 6) Finance / losses без вопроса — не SUCCESS discovery
  if (containsFinanceKeywords(q) || containsLossCalcKeywords(q)) {
    const stage = financeSubStage(q)
    const stageId = stageLabelToId(stage)
    const isObj = stageId === 'objections'
    // Если interrogative уже поймали выше — сюда не попадём.
    // NO_QUESTION_FOUND только когда в discovery-рамке реально нет вопроса.
    const ruleId: StageRuleId = isObj
      ? 'RULE_FINANCE_OBJECTION'
      : stageId === 'presentation'
        ? 'RULE_PRESENTATION_FEATURES'
        : 'RULE_NO_QUESTION_FOUND'

    const ok =
      isObj ||
      (stageId === 'presentation' && containsLossCalcKeywords(q))

    return {
      quote: q,
      stage,
      stageId,
      type: ok ? 'SUCCESS' : 'ERROR',
      ruleId,
      comment: isObj
        ? 'Ценовая / ROI-рамка — работа с возражением.'
        : containsLossCalcKeywords(q)
          ? 'Есть расчёт потерь, но нет вопроса клиенту — это не полноценное выявление.'
          : 'Цифры названы без вопроса и без next step.',
      whyBad: ok
        ? undefined
        : ruleId === 'RULE_NO_QUESTION_FOUND'
          ? RULE_WHY_BAD.RULE_NO_QUESTION_FOUND
          : RULE_WHY_BAD.RULE_FINANCE_VALUE,
      howToFix: howToFixForRule(ruleId),
    }
  }

  return {
    quote: q,
    stage: 'Выявление потребностей',
    stageId: 'discovery',
    type: 'ERROR',
    ruleId: 'RULE_FALLBACK',
    whyBad: RULE_WHY_BAD.RULE_FALLBACK,
    howToFix: howToFixForRule('RULE_FALLBACK'),
  }
}

export type AlignableMistake = {
  stageId: string
  managerQuote: string
  comment: string
  betterScript?: string
}

export type AlignableSuccess = {
  stageId: string
  managerQuote: string
  comment: string
  tag?: 'strong_argument'
}

/**
 * Пост-обработка карточек: дедуп + этика.
 * Stage берём из карточки (зафиксирован FSM в момент реплики) —
 * без post-hoc regex remap, который тащил цитаты между этапами.
 */
export function realignQuoteCards(input: {
  mistakes: AlignableMistake[]
  successes: AlignableSuccess[]
}): { mistakes: AlignableMistake[]; successes: AlignableSuccess[] } {
  const mistakes: AlignableMistake[] = []
  const successes: AlignableSuccess[] = []
  const seenErr = new Set<string>()
  const seenOk = new Set<string>()

  const pushErr = (m: AlignableMistake) => {
    const key = normalizeQuoteKey(m.managerQuote)
    if (!key || seenErr.has(key)) return
    if (seenOk.has(key)) {
      const idx = successes.findIndex(
        (s) => normalizeQuoteKey(s.managerQuote) === key,
      )
      if (idx >= 0) {
        successes.splice(idx, 1)
        seenOk.delete(key)
      }
    }
    seenErr.add(key)
    mistakes.push(m)
  }

  const pushOk = (s: AlignableSuccess) => {
    const key = normalizeQuoteKey(s.managerQuote)
    if (!key || seenOk.has(key)) return
    if (seenErr.has(key)) return // ERROR побеждает
    seenOk.add(key)
    successes.push(s)
  }

  for (const m of input.mistakes) {
    // Abuse → только этика
    if (containsProfanity(m.managerQuote)) {
      pushErr({
        stageId: 'contact',
        managerQuote: m.managerQuote,
        comment: 'Разговор сорван из-за нарушения деловой этики',
        betterScript: undefined,
      })
      continue
    }

    const stageId = (m.stageId || 'discovery') as ReportStageId
    pushErr({
      ...m,
      stageId,
      betterScript:
        m.betterScript?.trim() || howToFixForStage(stageId) || undefined,
    })
  }

  for (const s of input.successes) {
    if (containsProfanity(s.managerQuote)) {
      pushErr({
        stageId: 'contact',
        managerQuote: s.managerQuote,
        comment: 'Разговор сорван из-за нарушения деловой этики',
        betterScript: undefined,
      })
      continue
    }

    const stageId = (s.stageId || 'discovery') as ReportStageId
    let comment = s.comment
    if (justificationMismatchesStage(stageId, comment)) {
      comment = whyWorkedForStage(stageId)
    }
    pushOk({
      stageId,
      managerQuote: s.managerQuote,
      comment,
      tag: s.tag,
    })
  }

  return {
    mistakes,
    successes: sanitizeQuoteJustifications(successes),
  }
}

/** Stage-aware fallback для UI, если betterScript пустой. */
export function defaultBetterScriptForStage(stageId: string): string {
  return howToFixForStage(
    (['contact', 'discovery', 'presentation', 'objections', 'closing'].includes(
      stageId,
    )
      ? stageId
      : 'discovery') as ReportStageId,
  )
}
