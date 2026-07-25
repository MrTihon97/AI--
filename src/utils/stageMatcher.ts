/**
 * Priority stage classifier for the non-LLM evaluator.
 * Order: CLOSING → PRESENTATION → DISCOVERY (questions only) → other.
 */

export type MatchStageId =
  | 'contact'
  | 'discovery'
  | 'presentation'
  | 'objections'
  | 'closing'

export type StageRuleId =
  | 'RULE_ETHICS'
  | 'RULE_CLOSING_SLOT'
  | 'RULE_GREETING'
  | 'RULE_PRESENTATION_FEATURES'
  | 'RULE_DISCOVERY_QUESTION'
  | 'RULE_DISCOVERY_WEAK'
  | 'RULE_NO_QUESTION_FOUND'
  | 'RULE_FINANCE_OBJECTION'
  | 'RULE_FINANCE_VALUE'
  | 'RULE_FALLBACK'

const NORM = (q: string) => q.toLowerCase().replace(/ё/g, 'е')

/** Zoom / слот / CTA закрытия — выше любых «потерь» и «тысяч». */
export const CLOSING_TRIGGERS =
  /(?:\bzoom\b|зуум)|(?:(?:в|на)\s*)?(?:[01]?\d|2[0-3])\s*[:.]\s*[0-5]\d|(?:в\s*)?(?:11|12|13|14|15|16|17)\s*или\s*(?:в\s*)?(?:11|12|13|14|15|16|17)\b|включаемся\s+в\s*(?:zoom|зуум)|созвонимся\s+(?:завтра|сегодня|послезавтра)|давайте\s+(?:завтра|сегодня|послезавтра).{0,48}(?:zoom|зуум|слот|созвон|демо|минут)|(?:слот|демо|созвон)\s+(?:на\s+)?\d{1,2}\s*мин|назначим\s+(?:демо|созвон|встреч)|пришлю\s+ссылк|ссылк\w*\s+в\s*(?:whatsapp|ватсап|вотсап)|следующ(?:ий|им)\s+шаг|(?:завтра|сегодня).{0,40}(?:zoom|зуум|демо|слот|созвон)|(?:zoom|зуум|демо|слот).{0,40}(?:завтра|сегодня)/i

/**
 * Продуктовые фичи / ценность для клиента → презентация решения.
 * Мягкое сопоставление: короткие реплики и смесь с вопросами/возражениями тоже считаются.
 * Без голых каналов (WhatsApp) в diagnostic-вопросе — это не питч.
 */
export const PRESENTATION_FEATURES =
  /(автобот|автоответ|автодожим|блок\s+автоответ|подключаем|подключим|фиксирует\s+запись|фиксируем\s+запись|модул\w*|функци\w*|интеграц\w*|дашборд|автонапоминан|автоматизац\w*|ценност\w*|отлича\w*|едины[йе]\s+(дашборд|экран|систем)|филиал\w*.{0,32}(эконом|управлен|сводк|дашборд)|эконом\w*\s+филиал|решени[ея]|систем\w*\s+(закры|напомин|писа)|crm\s+(закры|напомин|писа|модул)|снижает?\s+(нагрузк|потер)|покаж(у|ем)\s+(как|модул|блок|дашборд))/i

/**
 * Нормализация перед детектцией вопроса:
 * trim + срезать хвостовую пунктуацию (`, . - — /`).
 */
export function normalizeQuestionText(quote: string): string {
  return NORM(quote)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,.;:!?\u2026\-/\\|]+$/g, '')
    .replace(/[\u2013\u2014]+$/g, '') // – —
    .trim()
}

/**
 * Русские вопросительные слова / конструкции.
 * Без JS `\b` (ломается на кириллице) — границы через «не буква».
 */
export const INTERROGATIVE_MARKERS =
  /(?:^|[^a-zа-я0-9])(?:кто|как|сколько|какой|какая|какие|каким|какую|какое|каких|почему|зачем|где|куда|когда|откуда|чем|успевает\s+ли|есть\s+ли|можно\s+ли|верно\s+ли|подскажите|скажите|уточните|расскажите)(?:$|[^a-zа-я0-9])/i

/**
 * Гибкая детекция вопроса: `?` ИЛИ вопросительные слова
 * (даже без `?` и с хвостовой пунктуацией).
 */
export function isQuestion(quote: string): boolean {
  if (!quote?.trim()) return false
  if (/\?/.test(quote)) return true
  const t = normalizeQuestionText(quote)
  if (!t) return false
  return INTERROGATIVE_MARKERS.test(` ${t} `)
}

/** @deprecated alias — то же, что isQuestion (для discovery-классификатора) */
export const DISCOVERY_QUESTION = INTERROGATIVE_MARKERS

export function isClosingStage(quote: string): boolean {
  const t = NORM(quote)
  if (CLOSING_TRIGGERS.test(t)) return true
  // HH:MM + CTA без слова Zoom
  if (
    /(?:[01]?\d|2[0-3])\s*[:.]\s*[0-5]\d/.test(t) &&
    /(давайте|предлагаю|удобн|слот|демо|созвон|встреч|пришлю|ссылк|минут)/i.test(t)
  ) {
    return true
  }
  // «завтра» только с CTA на встречу / канал
  if (
    /\bзавтра\b/.test(t) &&
    /(zoom|зуум|демо|слот|созвон|включа|пришлю|whatsapp|ватсап|ссылк|минут)/i.test(t)
  ) {
    return true
  }
  return false
}

export function isPresentationStage(quote: string): boolean {
  return PRESENTATION_FEATURES.test(NORM(quote))
}

export function isDiscoveryQuestion(quote: string): boolean {
  return isQuestion(quote)
}

/**
 * Диагностический / process-вопрос для DISCOVERY —
 * не путать с рамкой контакта («удобно 2 минуты?»).
 */
export function isDiscoveryDiagnosticQuote(quote: string): boolean {
  const t = NORM(quote).trim()
  if (!t) return false
  // Питч / фичи — не discovery («Как раз… подключаем автобота»)
  if (isPresentationStage(quote)) return false
  // Чистая проверка удобства / короткий hello — контакт, не discovery
  if (
    /удобно\s+(\d+\s+)?минут/i.test(t) &&
    !/(кто|сколько|как\s+(сейчас|у\s+вас|фиксир|отслежива|вед)|потер|заявк|неявк|журнал|excel|whatsapp|конверси|филиал)/i.test(
      t,
    )
  ) {
    return false
  }
  if (
    /^(привет|здравствуй(те)?|добрый(\s+день)?|алло)[.!?…]*$/i.test(t.trim())
  ) {
    return false
  }
  // «Как раз …» / утверждение с «как» — не вопрос
  if (
    /^как\s+раз\b/i.test(t) ||
    /(подключаем|покажем|автобот|модул|интеграц)/i.test(t)
  ) {
    if (!/\?/.test(quote) && !/(подскажите|скажите|уточните|кто\s+вед|сколько)/i.test(t)) {
      return false
    }
  }
  if (!isQuestion(quote) && !isDiscoveryQuestion(quote)) {
    // Без вопросительной рамки — только явные process-маркеры + вопросные слова
    if (
      !/(кто\s+вед|как\s+(сейчас|фиксир|отслежива)|сколько\s+(заяв|неяв|потер)|есть\s+ли|подскажите)/i.test(
        t,
      )
    ) {
      return false
    }
  }
  return /(кто|как|сколько|какой|какие|почему|есть\s+ли|успевает\s+ли|подскажите|скажите|уточните|расскажите|запис|журнал|excel|whatsapp|ватсап|потер|заявк|неявк|конверси|админ|филиал|мессенджер)/i.test(
    t,
  )
}

/** Рамка CONTACT_SETUP: приветствие / представление / удобно минут — без диагностики. */
export function isContactFrameQuote(quote: string): boolean {
  const t = NORM(quote).trim()
  if (!t) return false
  // Zoom / слот / next-step — не контакт
  if (isClosingStage(quote)) return false
  if (isDiscoveryDiagnosticQuote(quote)) {
    // Интро+диагностика в одной реплике: контакт только если есть явное представление
    return /(это\s+[a-zа-яё][a-zа-яё\d-]{1,24}|меня\s+зовут|компани[яи]|дента\s*crm|дентаcrm)/i.test(
      t,
    )
  }
  return (
    /(здравств|добр(ый|ое|ого)|привет|алло)/i.test(t) ||
    /удобно\s+(\d+\s+)?минут/i.test(t) ||
    /(это\s+[a-zа-яё]|меня\s+зовут|компани[яи]|дента\s*crm)/i.test(t)
  )
}

export function matchStagePriority(quote: string): {
  stageId: MatchStageId
  ruleId: StageRuleId
  reason: string
} | null {
  if (isClosingStage(quote)) {
    return {
      stageId: 'closing',
      ruleId: 'RULE_CLOSING_SLOT',
      reason: 'slot/zoom/CTA',
    }
  }
  if (isPresentationStage(quote)) {
    return {
      stageId: 'presentation',
      ruleId: 'RULE_PRESENTATION_FEATURES',
      reason: 'product features',
    }
  }
  if (isDiscoveryQuestion(quote)) {
    return {
      stageId: 'discovery',
      ruleId: 'RULE_DISCOVERY_QUESTION',
      reason: 'diagnostic question',
    }
  }
  return null
}

/** Шаблоны «как сказать правильно» строго по ruleId. */
export const RULE_HOW_TO_FIX: Record<StageRuleId, string> = {
  RULE_ETHICS:
    'Используйте только профессиональную лексику. Переход на личности и хамство в B2B недопустимы.',
  RULE_CLOSING_SLOT:
    'Зафиксируйте слот явно: «Завтра в 11:00 или 15:00 — 15 минут в Zoom, пришлю ссылку в WhatsApp. Какой слот ставим?»',
  RULE_GREETING:
    'Добрый день! Это [Имя], ДентаCRM. Удобно 2 минуты? Хочу понять потери на записи и предложить короткий разбор.',
  RULE_PRESENTATION_FEATURES:
    'Свяжите фичу с болью: «Подключаем автобот / блок автоответов — он фиксирует запись и снимает нагрузку с администратора. На вашей цифре потерь это даёт X».',
  RULE_DISCOVERY_QUESTION:
    'Уточните процесс: кто отвечает за дожим заявки и как считаете потери от неявок за месяц?',
  RULE_DISCOVERY_WEAK:
    'Задайте диагностический вопрос с цифрой: «Сколько заявок в неделю не доходит до визита и сколько стоит одна неявка?»',
  RULE_NO_QUESTION_FOUND:
    'Добавьте вопрос клиенту: «Кто ведёт запись?» / «Сколько заявок теряется в неделю?»',
  RULE_FINANCE_OBJECTION:
    'Ответьте экономикой: «Подписка 3–5 тыс. Если вернём хотя бы часть неявок — она отбивается за недели. Сверим с вашей статистикой на 10 минут?»',
  RULE_FINANCE_VALUE:
    'Свяжите цифру с решением и next step: «На 30–50 тыс. потерь модуль напоминаний окупается быстро — давайте слот на 10 минут завтра».',
  RULE_FALLBACK:
    'Каждая реплика либо собирает данные вопросом, либо ведёт к конкретному слоту Zoom с датой и временем.',
}

export const RULE_WHY_BAD: Partial<Record<StageRuleId, string>> = {
  RULE_ETHICS:
    'Диалог сорван из-за нарушения деловой этики и недопустимого тона.',
  RULE_PRESENTATION_FEATURES:
    'Фичи названы без жёсткой привязки к боли/потерям клиента — звучит как каталог, а не решение.',
  RULE_DISCOVERY_WEAK:
    'Нет диагностического вопроса клиенту. Назовите процесс вопросом: кто / как / сколько.',
  RULE_NO_QUESTION_FOUND:
    'Нет вопроса клиенту. Ключевые слова без вопросительной конструкции не двигают выявление потребностей.',
  RULE_FINANCE_VALUE:
    'Цифра есть, но нет вопроса клиенту и нет связки с решением / слотом.',
  RULE_FALLBACK:
    'Реплика не двигает этап продажи: нет вопроса, презентации ценности или next step.',
}

export function howToFixForRule(ruleId: StageRuleId): string {
  return RULE_HOW_TO_FIX[ruleId]
}

export function howToFixForStage(
  stageId: MatchStageId,
  prefer?: StageRuleId,
): string {
  if (prefer) return RULE_HOW_TO_FIX[prefer]
  switch (stageId) {
    case 'closing':
      return RULE_HOW_TO_FIX.RULE_CLOSING_SLOT
    case 'presentation':
      return RULE_HOW_TO_FIX.RULE_PRESENTATION_FEATURES
    case 'discovery':
      return RULE_HOW_TO_FIX.RULE_DISCOVERY_QUESTION
    case 'objections':
      return RULE_HOW_TO_FIX.RULE_FINANCE_OBJECTION
    case 'contact':
      return RULE_HOW_TO_FIX.RULE_GREETING
    default:
      return RULE_HOW_TO_FIX.RULE_FALLBACK
  }
}
