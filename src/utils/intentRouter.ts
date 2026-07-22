import bank from '../data/dialogue-bank.json'
import extra from '../data/dialogue-bank-extra.json'
import personas from '../data/persona-overlays.json'
import type { Intent, Scenario, SmartReplyResult } from '../types'

export interface DialogueIntent {
  id: string
  priority: number
  advance: boolean
  keywords: string[]
  replies: string[]
}

interface DialogueBank {
  intents: DialogueIntent[]
  default_fallback: string[]
  short_message_fallback: string[]
}

interface ExtraBank {
  extraReplies: Record<string, string[]>
}

function mergeBank(base: DialogueBank, extraBank: ExtraBank): DialogueBank {
  const extraMap = extraBank.extraReplies
  const intents = base.intents.map((intent) => {
    const more = extraMap[intent.id]
    if (!more?.length) return intent
    return { ...intent, replies: dedupeReplies([...intent.replies, ...more]) }
  })

  return {
    ...base,
    intents,
    default_fallback: dedupeReplies([
      ...base.default_fallback,
      ...(extraMap.default_fallback ?? []),
    ]),
    short_message_fallback: dedupeReplies([
      ...base.short_message_fallback,
      ...(extraMap.short_message_fallback ?? []),
    ]),
  }
}

function dedupeReplies(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    const key = item.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item.trim())
  }
  return out
}

const dialogueBank = mergeBank(bank as DialogueBank, extra as ExtraBank)

type PersonaOverlays = Record<
  string,
  { label?: string; intentReplies: Record<string, string[]> }
>

const personaOverlays = personas as PersonaOverlays

function getPersonaPool(clientId: string | undefined, intentId: string): string[] {
  if (!clientId) return []
  return personaOverlays[clientId]?.intentReplies?.[intentId] ?? []
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

/** Синонимы/темы — чтобы ответ попадал в вопрос, а не рандом из пула. */
const TOPIC_GROUPS: string[][] = [
  ['журнал', 'тетрад', 'бумаг', 'закладк', 'excel', 'эксель', 'таблиц'],
  ['whatsapp', 'ватсап', 'телеграм', 'instagram', 'смс', 'мессенджер'],
  ['запись', 'записыв', 'расписан', 'кресл', 'слот', 'окн'],
  ['потер', 'теря', 'заявк', 'лид', 'недозвон', 'не перезвон', 'пропущен'],
  ['администратор', 'ирина', 'сотрудник', 'персонал'],
  ['гигиен', 'повторн', 'возврат', 'обзвон', 'напоминан'],
  ['цена', 'стоимость', 'тариф', 'дорого', 'бюджет', 'скидк', 'плат'],
  ['внедр', 'обучен', 'перенос', 'миграц', 'простой', 'за один день'],
  ['демо', 'созвон', 'тест', 'пилот', 'встреч', 'завтра'],
  ['1с', 'медодс', 'битрикс', 'конкурент', 'аналог', 'crm'],
  ['филиал', 'сеть', 'дашборд', 'отчет', 'отчёт', 'конверси'],
  ['данн', '152', 'безопас', 'сервер', 'пдн'],
]

const STOP_WORDS = new Set([
  'это', 'как', 'что', 'или', 'для', 'про', 'вас', 'вам', 'наш', 'наши',
  'есть', 'было', 'будет', 'можно', 'нужно', 'скажите', 'сколько', 'какой',
  'какая', 'какие', 'кто', 'где', 'когда', 'почему', 'минуту', 'пожалуйста',
  'добрый', 'день', 'здравствуйте', 'удобно',
])

function significantTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
}

function topicBoost(userClean: string, replyClean: string): number {
  let boost = 0
  for (const group of TOPIC_GROUPS) {
    const inUser = group.some((t) => userClean.includes(t))
    const inReply = group.some((t) => replyClean.includes(t))
    if (inUser && inReply) boost += 6
  }
  return boost
}

function relevanceScore(userText: string, reply: string): number {
  const userClean = normalize(userText)
  const replyClean = normalize(reply)
  const userTokens = significantTokens(userText)
  if (userTokens.length === 0) return 0

  let score = topicBoost(userClean, replyClean)
  for (const token of userTokens) {
    const stem = token.slice(0, Math.min(token.length, 6))
    if (replyClean.includes(token)) score += 4
    else if (stem.length >= 4 && replyClean.includes(stem)) score += 2
  }
  return score
}

/**
 * Берём реплику по смыслу вопроса (топ по релевантности), не рандом из всего пула.
 */
function pickFreshReply(
  pool: string[],
  used: string[],
  userText = '',
): string {
  if (pool.length === 0) return '…'
  const usedSet = new Set(used)
  const fresh = pool.filter((r) => !usedSet.has(r))
  const candidates = fresh.length > 0 ? fresh : pool

  const recentStarts = used
    .slice(-8)
    .map((u) => normalize(u).slice(0, 28))
    .filter(Boolean)

  const diverse = candidates.filter((r) => {
    const start = normalize(r).slice(0, 28)
    return !recentStarts.some(
      (s) => s && (start.startsWith(s) || s.startsWith(start)),
    )
  })

  const pool2 = diverse.length > 0 ? diverse : candidates

  if (!userText.trim()) {
    const shortish = pool2.filter((r) => r.length <= 110)
    return pickRandom(shortish.length >= 3 ? shortish : pool2)
  }

  const ranked = pool2
    .map((reply) => ({ reply, score: relevanceScore(userText, reply) }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]?.score ?? 0
  if (best <= 0) {
    // Нет пересечения — лучше короткая нейтральная из пула, чем «рандомная боль»
    const shortish = pool2.filter((r) => r.length <= 90)
    return pickRandom(shortish.length >= 2 ? shortish : pool2)
  }

  const top = ranked.filter((r) => r.score >= best - 2).slice(0, 5)
  return pickRandom(top).reply
}

function pickReplyForClient(
  intentId: string,
  basePool: string[],
  used: string[],
  clientId?: string,
  userText = '',
): string {
  const personaPool = getPersonaPool(clientId, intentId)
  const combined = [...personaPool, ...basePool]

  // Сначала ищем релевантный ответ во всём доступном пуле
  if (userText.trim() && combined.length > 0) {
    const ranked = combined
      .map((reply) => ({ reply, score: relevanceScore(userText, reply) }))
      .sort((a, b) => b.score - a.score)
    const best = ranked[0]
    if (best && best.score >= 4) {
      // При хорошем матче предпочитаем его (персона, если она в топе)
      const top = ranked.filter((r) => r.score >= best.score - 2).slice(0, 6)
      const personaHits = top.filter((t) => personaPool.includes(t.reply))
      const pickFrom = personaHits.length > 0 && Math.random() < 0.85 ? personaHits : top
      const chosen = pickRandom(pickFrom).reply
      if (!used.includes(chosen)) return chosen
    }
  }

  if (personaPool.length > 0 && Math.random() < 0.9) {
    return pickFreshReply(personaPool, used, userText)
  }
  return pickFreshReply(combined, used, userText)
}

function mapToLegacyIntent(id: string): Intent {
  switch (id) {
    case 'greeting':
      return 'greeting'
    case 'price_inquiry':
    case 'price_objection':
      return 'price'
    case 'need_discovery':
    case 'value_challenge':
      return 'discovery'
    case 'product_pitch_response':
    case 'implementation_fear':
    case 'trust_competitors':
    case 'authority_gate':
    case 'security_compliance':
      return 'objection'
    case 'closing':
      return 'close'
    case 'offtopic_confused':
    case 'aggression_pushback':
    case 'smalltalk_redirect':
    case 'timing_busy':
    case 'doubt_skepticism':
    case 'rapport_pushback':
      return 'confused'
    default:
      return 'unknown'
  }
}

/** Сильные фразы (вес выше одиночных слов). Порядок: длинные первыми. */
const PHRASE_RULES: Array<{ intentId: string; phrases: string[]; weight: number }> = [
  {
    intentId: 'greeting',
    weight: 8,
    phrases: [
      'добрый день',
      'доброе утро',
      'добрый вечер',
      'доброго дня',
      'здравствуйте',
      'здравствуй',
      'рад познакомиться',
      'рада познакомиться',
      'на связи',
    ],
  },
  {
    intentId: 'price_objection',
    weight: 10,
    phrases: [
      'слишком дорого',
      'это дорого',
      'очень дорого',
      'дорого для',
      'не потянем',
      'не по карману',
      'цена кусается',
      'завышен',
      'перебор',
      'жирно',
      'скидку',
      'есть скидка',
      'сделайте скидку',
      'дешевле',
      'не готовы платить',
      'нет бюджета',
      'бюджет не',
    ],
  },
  {
    intentId: 'price_inquiry',
    weight: 9,
    phrases: [
      'сколько стоит',
      'какая цена',
      'какая стоимость',
      'какой тариф',
      'какие тарифы',
      'о каком бюджете',
      'во сколько обойдется',
      'прайс',
      'прайс лист',
      'ценник',
      'стоимость владения',
      'ежемесячн',
      'в месяц',
      'за год',
    ],
  },
  {
    intentId: 'closing',
    weight: 10,
    phrases: [
      'давайте демо',
      'назначить демо',
      'провести демо',
      'тестовый доступ',
      'тестовый период',
      'коммерческое предложение',
      'пришлю кп',
      'отправлю кп',
      'давайте созвонимся',
      'назначим встречу',
      'зафиксируем',
      'пилот',
      'zoom',
      'google meet',
      'в вотсап',
      'в ватсап',
      'в whatsapp',
      'в телеграм',
      'следующий шаг',
      'когда удобно',
    ],
  },
  {
    intentId: 'need_discovery',
    weight: 8,
    phrases: [
      'теряете заявк',
      'потери заяв',
      'как сейчас ведете',
      'как сейчас ведёте',
      'бумажный журнал',
      'в excel',
      'в эксель',
      'администратор забывает',
      'не перезванивает',
      'пропущенные звонки',
      'пустые окна',
      'пустых окон',
      'повторные визиты',
      'откуда приходят',
      'как записываете',
      'сколько заявок',
      'какая конверсия',
      'кто ведёт запись',
      'кто ведет запись',
      'на гигиену',
      'обзвон',
    ],
  },
  {
    intentId: 'value_challenge',
    weight: 9,
    phrases: [
      'какая выгода',
      'какая польза',
      'что это даст',
      'зачем вам',
      'зачем нам',
      'окупаемость',
      'окупится',
      'roi',
      'в рублях',
      'экономия',
      'какой эффект',
      'какой результат',
    ],
  },
  {
    intentId: 'trust_competitors',
    weight: 10,
    phrases: [
      'уже есть crm',
      'уже пользуемся',
      'сидим на',
      'у нас уже стоит',
      'чем вы лучше',
      'чем отличаетесь',
      'медодс',
      'на 1с',
      'битрикс',
      'амосрм',
      'amo crm',
      'другая система',
      'текущий софт',
      'менять не хотим',
      'переезд базы',
      'миграция',
    ],
  },
  {
    intentId: 'implementation_fear',
    weight: 9,
    phrases: [
      'сколько занимает внедрение',
      'как проходит внедрение',
      'обучение персонала',
      'сотрудники не разберутся',
      'перенос базы',
      'перенести данные',
      'простой клиники',
      'внедрим за день',
      'паралич записи',
    ],
  },
  {
    intentId: 'security_compliance',
    weight: 10,
    phrases: [
      '152 фз',
      '152-фз',
      'персональные данные',
      'медицинская тайна',
      'где хранятся',
      'сервера в рф',
      'защита данных',
      'утечка',
      'доступ сотрудникам',
    ],
  },
  {
    intentId: 'doubt_skepticism',
    weight: 8,
    phrases: [
      'надо подумать',
      'нужно подумать',
      'подумаем',
      'не уверен',
      'не уверена',
      'не сейчас',
      'не актуально',
      'вернусь позже',
      'через месяц',
      'пока не готов',
      'пока не готова',
      'сомневаюсь',
      'не факт',
    ],
  },
  {
    intentId: 'authority_gate',
    weight: 9,
    phrases: [
      'я не решаю',
      'не мой уровень',
      'нужно согласовать',
      'с директором',
      'с собственником',
      'с партнером',
      'с партнёром',
      'руководство решит',
      'лпр',
      'кто принимает решение',
    ],
  },
  {
    intentId: 'timing_busy',
    weight: 8,
    phrases: [
      'нет времени',
      'сейчас некогда',
      'сейчас занят',
      'сейчас занята',
      'давайте позже',
      'перезвоните',
      'пациент ждет',
      'пациент ждёт',
      'на приеме',
      'на приёме',
      'бегу',
      'совещание',
    ],
  },
  {
    intentId: 'aggression_pushback',
    weight: 12,
    phrases: [
      'не звоните',
      'отстаньте',
      'достали',
      'это спам',
      'развод',
      'кидалово',
      'бред',
      'ерунда',
    ],
  },
  {
    intentId: 'smalltalk_redirect',
    weight: 8,
    phrases: ['как дела', 'как жизнь', 'какая погода', 'выходные', 'футбол'],
  },
  {
    intentId: 'product_pitch_response',
    weight: 7,
    phrases: [
      'как работает',
      'какие функции',
      'есть интеграция',
      'интеграция с',
      'whatsapp',
      'напоминан',
      'дашборд',
      'аналитика',
      'отчеты',
      'отчёты',
      'мобильное приложение',
      'api',
      'телефония',
    ],
  },
  {
    intentId: 'rapport_pushback',
    weight: 6,
    phrases: [
      'понимаю вашу боль',
      'в вашей сфере',
      'у коллег видел',
      'слышал что у вас',
      'сталкивались с',
    ],
  },
  {
    intentId: 'offtopic_confused',
    weight: 5,
    phrases: ['не понял', 'в смысле', 'что вы имеете в виду', 'ало', 'huh', 'wtf'],
  },
]

/** Короткие токены — только целое слово (не подстрока). */
const WORD_RULES: Array<{ intentId: string; words: string[]; weight: number }> = [
  {
    intentId: 'greeting',
    weight: 4,
    words: ['привет', 'здравствуйте', 'здравствуй', 'алло', 'хеллоу', 'хай', 'салют'],
  },
  {
    intentId: 'price_objection',
    weight: 6,
    words: ['дорого', 'дешевле', 'скидка', 'скидку', 'перебор', 'кусается'],
  },
  {
    intentId: 'price_inquiry',
    weight: 5,
    words: ['цена', 'цен', 'стоимость', 'прайс', 'тариф', 'тарифы', 'ценник', 'подписк', 'лицензи'],
  },
  {
    intentId: 'closing',
    weight: 5,
    words: ['демо', 'пилот', 'zoom', 'кп', 'договор', 'созвон', 'слот'],
  },
  {
    intentId: 'need_discovery',
    weight: 4,
    words: [
      'журнал',
      'администратор',
      'пациент',
      'пациенты',
      'заявки',
      'заявка',
      'потери',
      'расписание',
      'лиды',
      'воронка',
    ],
  },
  {
    intentId: 'trust_competitors',
    weight: 6,
    words: ['медодс', 'битрикс', 'конкуренты', 'аналог', 'альтернатива', 'миграция'],
  },
  {
    intentId: 'aggression_pushback',
    weight: 8,
    words: ['дурак', 'тупой', 'спам', 'отстань', 'достал'],
  },
]

const PRIORITY: Record<string, number> = Object.fromEntries(
  dialogueBank.intents.map((i) => [i.id, i.priority]),
)

function wordMatches(words: Set<string>, stemRaw: string): boolean {
  const stem = normalize(stemRaw)
  if (!stem) return false
  if (words.has(stem)) return true
  if (stem.length < 4) return false
  for (const w of words) {
    if (w.length < 4) continue
    if (w.startsWith(stem) || stem.startsWith(w)) return true
  }
  return false
}

function scoreIntent(clean: string, words: Set<string>): Map<string, number> {
  const scores = new Map<string, number>()

  const add = (id: string, w: number) => {
    scores.set(id, (scores.get(id) ?? 0) + w)
  }

  for (const rule of PHRASE_RULES) {
    for (const phrase of rule.phrases) {
      const needle = normalize(phrase)
      if (needle && clean.includes(needle)) add(rule.intentId, rule.weight)
    }
  }

  for (const rule of WORD_RULES) {
    for (const word of rule.words) {
      if (wordMatches(words, word)) add(rule.intentId, rule.weight)
    }
  }

  // Доп. эвристики из словаря банка (только длинные keywords ≥5)
  for (const intent of dialogueBank.intents) {
    for (const kw of intent.keywords) {
      const needle = normalize(kw)
      if (needle.length < 5) continue
      if (clean.includes(needle)) add(intent.id, needle.includes(' ') ? 3 : 2)
    }
  }

  return scores
}

/**
 * Классификация реплики менеджера.
 * scriptStep гасит ложные greeting/offtopic в середине диалога.
 */
export function detectIntentId(
  text: string,
  scriptStep = 0,
): { intentId: string; score: number } {
  const clean = normalize(text)
  const words = new Set(clean.split(' ').filter(Boolean))

  if (clean.length === 0) {
    return { intentId: 'offtopic_confused', score: 100 }
  }

  // Односложные / ультракороткие
  if (
    clean.length < 4 ||
    /^(а|ну|эм|мм|ок|угу|ага|да|нет|че|чё|хм|ммм)$/i.test(clean)
  ) {
    return { intentId: 'offtopic_confused', score: 90 }
  }

  const scores = scoreIntent(clean, words)

  // Контекст шага: greeting почти только в начале
  if (scriptStep >= 2) {
    const g = scores.get('greeting') ?? 0
    if (g > 0 && g < 12) scores.delete('greeting')
    else if (g > 0) scores.set('greeting', Math.floor(g * 0.35))
  }

  // «Понимаю» без фразы про боль — не rapport
  if ((scores.get('rapport_pushback') ?? 0) > 0 && !clean.includes('боль')) {
    const r = scores.get('rapport_pushback') ?? 0
    if (r < 8) scores.delete('rapport_pushback')
  }

  // «что» / короткие вопросительные без темы → offtopic только если нет других сигналов
  const hasSubstance = [...scores.entries()].some(
    ([id, s]) => id !== 'offtopic_confused' && s >= 5,
  )
  if (!hasSubstance && (clean.length < 18 || /^(ну |а |и )/i.test(clean))) {
    return { intentId: 'offtopic_confused', score: 40 }
  }

  // Цена: «дорого» важнее «сколько» если оба
  const priceObj = scores.get('price_objection') ?? 0
  const priceAsk = scores.get('price_inquiry') ?? 0
  if (priceObj >= 6 && priceAsk > 0 && priceObj >= priceAsk) {
    scores.delete('price_inquiry')
  }

  // «Сколько заявок/окон» — не прайс
  if (
    /(заявок|окон|пациентов|звонков|лидов|визитов)/.test(clean) &&
    !/(стоит|цена|тариф|бюджет|руб|стоим)/.test(clean)
  ) {
    scores.delete('price_inquiry')
    const d = scores.get('need_discovery') ?? 0
    scores.set('need_discovery', d + 8)
  }

  // Closing vs doubt: «подумаем» не закрытие
  if ((scores.get('doubt_skepticism') ?? 0) >= 8) {
    const c = scores.get('closing') ?? 0
    if (c > 0 && c < 12) scores.delete('closing')
  }

  let best: { intentId: string; score: number } | null = null
  for (const [intentId, score] of scores) {
    if (score < 4) continue
    const priority = PRIORITY[intentId] ?? 0
    if (
      !best ||
      score > best.score ||
      (score === best.score && priority > (PRIORITY[best.intentId] ?? 0))
    ) {
      best = { intentId, score }
    }
  }

  if (!best) return { intentId: 'unknown', score: 0 }
  return best
}

function getIntentById(id: string): DialogueIntent | undefined {
  return dialogueBank.intents.find((i) => i.id === id)
}

/** Интенты прошлых реплик менеджера — лёгкая «память» диалога. */
function priorManagerIntentIds(messages: { role: string; text: string }[]): string[] {
  return messages
    .filter((m) => m.role === 'manager')
    .map((m) => detectIntentId(m.text, 2).intentId)
}

function refineIntentWithMemory(
  intentId: string,
  priorIds: string[],
): string {
  const hadPrice = priorIds.some(
    (id) => id === 'price_inquiry' || id === 'price_objection',
  )

  const sequence = [...priorIds, intentId]
  const offtopicSet = new Set([
    'offtopic_confused',
    'smalltalk_redirect',
    'aggression_pushback',
  ])
  let recentOfftopic = 0
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (offtopicSet.has(sequence[i]!)) recentOfftopic++
    else break
  }

  // 3+ шумных реплик подряд → клиент сворачивает разговор
  if (
    recentOfftopic >= 3 &&
    (intentId === 'offtopic_confused' ||
      intentId === 'unknown' ||
      intentId === 'smalltalk_redirect')
  ) {
    return 'timing_busy'
  }

  // Цена уже была в прошлых репликах — повторный прайс → возражение / ценность
  if (hadPrice && intentId === 'price_inquiry') {
    return Math.random() < 0.55 ? 'price_objection' : 'value_challenge'
  }

  return intentId
}

export function routeSmartReply(
  userText: string,
  scriptStep: number,
  scenario: Scenario,
  historyClientReplies: string[] = [],
  clientId?: string,
  historyMessages: { role: string; text: string }[] = [],
): SmartReplyResult {
  const used = historyClientReplies.slice(-20)
  const priorIds = priorManagerIntentIds(historyMessages)
  let { intentId } = detectIntentId(userText, scriptStep)
  intentId = refineIntentWithMemory(intentId, priorIds)

  const intent = getIntentById(intentId)
  const clean = normalize(userText)

  if (clean.length < 4 && intentId === 'offtopic_confused') {
    const shortPool = [
      ...getPersonaPool(clientId, 'offtopic_confused'),
      ...dialogueBank.short_message_fallback,
    ]
    return {
      intent: 'confused',
      reply: pickFreshReply(shortPool, used, userText),
      nextStep: scriptStep,
      intentId: 'offtopic_confused',
    }
  }

  if (intent) {
    const reply = pickReplyForClient(
      intent.id,
      intent.replies,
      used,
      clientId,
      userText,
    )
    const legacy = mapToLegacyIntent(intent.id)

    let nextStep = scriptStep
    if (intent.id === 'closing') {
      nextStep = scenario.clientReplies.length
    } else if (intent.id === 'greeting') {
      nextStep = Math.max(scriptStep, 1)
    } else if (intent.advance) {
      nextStep = Math.min(
        scriptStep + 1,
        Math.max(scenario.clientReplies.length, scriptStep + 1),
      )
    }

    return {
      intent: legacy,
      reply,
      nextStep,
      intentId: intent.id,
    }
  }

  const useScriptLine =
    scriptStep < scenario.clientReplies.length && Math.random() > 0.72

  if (useScriptLine) {
    return {
      intent: 'unknown',
      reply: scenario.clientReplies[scriptStep]!,
      nextStep: scriptStep + 1,
      intentId: 'script_line',
    }
  }

  return {
    intent: 'unknown',
    reply: pickReplyForClient(
      'default_fallback',
      dialogueBank.default_fallback,
      used,
      clientId,
      userText,
    ),
    nextStep: scriptStep + (scriptStep < scenario.clientReplies.length ? 1 : 0),
    intentId: 'default_fallback',
  }
}
