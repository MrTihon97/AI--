import bank from '../data/dialogue-bank.json'
import extra from '../data/dialogue-bank-extra.json'
import personas from '../data/persona-overlays.json'
import { isSlotTimeInput } from '../dialogue/entities'
import { containsAbuse } from '../utils/abuseDetect'
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

function isAggression(text: string): boolean {
  return containsAbuse(text)
}

export { isAggression }

const AGGRESSION_REPLIES: Record<string, string[]> = {
  marina: [
    'Так разговаривать не будем. Либо по делу — либо кладу трубку.',
    'Хамство не слушаю. Если есть нормальный вопрос по записи пациентов — говорите.',
    'Я на работе. Без оскорблений, иначе до свидания.',
  ],
  artem: [
    'Так разговаривать не будем. Либо КП и суть по сети — либо конец звонка.',
    'Хамство мимо. Если есть деловое предложение для Дент-Альянс — одно предложение.',
    'Я кладу трубку при таком тоне. Вернётесь по делу — поговорим.',
  ],
  generic: [
    'Давайте без грубости. Либо по делу, либо до свидания.',
    'Оскорбления не аргумент. Есть предложение — формулируйте коротко.',
  ],
}

// ────────────────────────────────────────────────────────────────────────
// 1) NONSENSE / SPAM FILTER — до любого поиска смысла
// ────────────────────────────────────────────────────────────────────────

const VOWELS = new Set('аеёиоуыэюяaeiouy'.split(''))

/** Короткий словарь реальных слов/стеммов (RU+EN) для отсечения «уцауца». */
const REAL_WORD_STEMS = [
  // контакт / общие
  'привет', 'здравств', 'добр', 'день', 'утро', 'вечер', 'удобно', 'минут',
  'пожалуйста', 'спасибо', 'хорошо', 'понял', 'понят', 'слуша', 'говор',
  'скаж', 'расскаж', 'уточн', 'вопрос', 'ответ', 'связ', 'звон',
  // продажи / клиника
  'цена', 'стоим', 'тариф', 'прайс', 'бюджет', 'дорого', 'дешев', 'скидк',
  'окуп', 'выгод', 'эффект', 'результат', 'ценност', 'экономи', 'потер',
  'заявк', 'пациент', 'клиник', 'запись', 'расписан', 'администратор',
  'журнал', 'excel', 'эксель', 'whatsapp', 'ватсап', 'телеграм', 'мессенджер',
  'неявк', 'гигиен', 'повторн', 'обзвон', 'недозвон', 'лид', 'конверси',
  'crm', 'дента', 'модул', 'функц', 'интеграц', 'автоматиз', 'напоминан',
  'дашборд', 'отчет', 'отчёт', 'аналитик', 'филиал', 'сеть',
  'внедрен', 'обучен', 'перенос', 'миграц', 'простой', 'пилот', 'демо',
  'созвон', 'встреч', 'zoom', 'слот', 'завтра', 'послезавтра', 'календар',
  'конкурент', 'медодс', 'битрикс', 'альтернатив', 'безопас', 'данных',
  'сервер', 'гарант', 'пример', 'клиник', 'формул', 'roi',
  // связка / служеб
  'наш', 'ваш', 'можно', 'нужно', 'хочу', 'давайте', 'предлага', 'покаж',
  'счита', 'считаем', 'месяц', 'недел', 'деньг', 'рубл', 'тысяч',
  'систем', 'решен', 'продукт', 'подписк', 'лиценз', 'договор', 'кп',
  'партнер', 'партнёр', 'директор', 'руководств', 'сотрудник', 'персонал',
  'hello', 'hi', 'price', 'cost', 'demo', 'meeting', 'crm', 'clinic',
]

const NONSENSE_REPLIES_MARINA = [
  'Извините, я не совсем поняла, что вы имеете в виду.',
  'Вы меня слышите? Давайте говорите по делу.',
  'Странный ответ... У вас всё хорошо со связью?',
]

const NONSENSE_REPLIES_ARTEM = [
  'Не понял. Сформулируйте нормально — по делу.',
  'Связь плохая? Повторите мысль одной фразой.',
  'Это не похоже на предложение. Говорите по существу.',
]

const NONSENSE_REPLIES_GENERIC = [
  'Извините, я не совсем поняла, что вы имеете в виду.',
  'Вы меня слышите? Давайте говорите по делу.',
  'Странный ответ... У вас всё хорошо со связью?',
]

function lettersOnly(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я]/gi, '')
}

function wordList(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean)
}

function hasRepeatedCharSpam(text: string): boolean {
  const chars = lettersOnly(text)
  if (chars.length < 4) return false

  const freq = new Map<string, number>()
  for (const ch of chars) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  const maxRepeat = Math.max(...freq.values())
  const unique = freq.size

  // "aaaa" / "aaaa...yyyy" — один-два символа доминируют
  if (maxRepeat / chars.length >= 0.55) return true
  if (unique <= 2 && chars.length >= 6) return true
  if (unique <= 3 && maxRepeat / chars.length >= 0.4 && chars.length >= 8) return true
  return false
}

function hasRepeatedWordSpam(words: string[]): boolean {
  if (words.length < 4) return false
  const counts = new Map<string, number>()
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)
  const max = Math.max(...counts.values())
  const unique = counts.size
  // «привет привет привет…»
  if (max / words.length >= 0.5) return true
  if (unique === 1 && words.length >= 3) return true
  if (unique / words.length < 0.25 && words.length >= 6) return true
  return false
}

function hasAbnormalWordLengths(words: string[]): boolean {
  if (words.length === 0) return true
  // одно «слово» из 12+ букв без гласных / слишком длинное
  for (const w of words) {
    if (w.length >= 12) {
      const vowels = [...w].filter((c) => VOWELS.has(c)).length
      if (vowels === 0) return true
      if (w.length >= 20 && vowels / w.length < 0.15) return true
    }
    if (w.length >= 35) return true
  }
  if (words.length === 1 && words[0]!.length >= 12) {
    const w = words[0]!
    const vowels = [...w].filter((c) => VOWELS.has(c)).length
    if (vowels / w.length < 0.2) return true
  }
  return false
}

function countRealWordHits(words: string[]): number {
  let hits = 0
  for (const w of words) {
    if (w.length < 2) continue
    const hit = REAL_WORD_STEMS.some(
      (stem) => w.includes(stem) || stem.includes(w) || w.startsWith(stem.slice(0, Math.min(4, stem.length))),
    )
    if (hit) hits++
  }
  return hits
}

function looksLikeKeyboardSmash(text: string): boolean {
  const chars = lettersOnly(text)
  if (chars.length < 6) return false

  const vowels = [...chars].filter((c) => VOWELS.has(c)).length
  const vowelRatio = vowels / chars.length

  // «уцауцауца» — мало гласных, повторяющиеся слоги
  if (vowelRatio < 0.22 && chars.length >= 8) return true

  // повторяющийся короткий слог: уцауца, блаблабла, асыасы
  if (/^(.{2,4})\1{2,}$/i.test(chars)) return true
  if (/(.{2,3})\1{2,}/i.test(chars) && vowelRatio < 0.35) return true

  return false
}

/**
 * Garbage / nonsense filter.
 * Возвращает true для «ааааа», «уцауца», «привет привет…», keyboard smash.
 */
const SHORT_HELLO_RE =
  /^(привет|приветик|здравствуй(те)?|добрый(\s+(день|вечер|утро))?|алло|ало|хай|хеллоу|салют|да|слушаю|угу|ага)[.!?…]*$/i

export function isNonsenseSpam(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true

  // Короткое приветствие / «алло» — никогда не спам
  if (SHORT_HELLO_RE.test(trimmed)) return false
  // «13:00» / «16:00?» — подтверждение слота, не nonsense
  if (isSlotTimeInput(trimmed)) return false

  const words = wordList(trimmed)
  const chars = lettersOnly(trimmed)

  // совсем нет букв
  if (chars.length === 0) return true

  if (hasRepeatedCharSpam(trimmed)) return true
  if (hasRepeatedWordSpam(words)) return true
  if (hasAbnormalWordLengths(words)) return true
  if (looksLikeKeyboardSmash(trimmed)) return true

  // нет ни одного узнаваемого слова из словаря
  const realHits = countRealWordHits(words)
  if (chars.length >= 6 && realHits === 0) return true

  // длинный текст без реальных слов / с 1 случайным совпадением стемма
  if (trimmed.length >= 40 && realHits <= 1 && words.length >= 3) {
    const uniqueRatio = new Set(words).size / words.length
    if (uniqueRatio < 0.4) return true
  }

  return false
}

function nonsenseRepliesFor(clientId?: string): string[] {
  if (clientId === 'marina') return NONSENSE_REPLIES_MARINA
  if (clientId === 'artem') return NONSENSE_REPLIES_ARTEM
  return NONSENSE_REPLIES_GENERIC
}

const NEUTRAL_CLARIFY_REPLIES: Record<string, string[]> = {
  marina: [
    'Не совсем уловила мысль. Уточните, пожалуйста, про что именно вопрос — запись, цена или демо?',
    'Давайте по делу: что хотите прояснить — потери заявок, стоимость или следующий шаг?',
    'Повторите короче: какой один вопрос сейчас главный?',
  ],
  artem: [
    'Не поймал тезис. Уточните: сравнение с текущей системой, ROI или слот на демо?',
    'Сформулируйте одним предложением: что нужно решить на этом звонке?',
    'Коротко: цена, интеграция или следующий шаг — что из этого?',
  ],
  generic: [
    'Уточните, пожалуйста: о чём именно речь — цена, процесс или следующий шаг?',
    'Не совсем понял. Повторите вопрос по делу одной фразой.',
  ],
}

// ────────────────────────────────────────────────────────────────────────
// 3) Восприимчивость к длинным осмысленным текстам
// ────────────────────────────────────────────────────────────────────────

/** Порог развёрнутой аргументации (символы). */
/** Порог «развёрнутой» реплики менеджера (раньше 120 — длинные интро часто не ловились). */
export const LONG_TEXT_THRESHOLD = 90

/** Минимум уникальных слов для развёрнутой аргументации. */
const MIN_DEVELOPED_UNIQUE_WORDS = 7

function hasCharacterDiversity(text: string): boolean {
  const chars = lettersOnly(text)
  if (chars.length === 0) return false

  const freq = new Map<string, number>()
  for (const ch of chars) freq.set(ch, (freq.get(ch) ?? 0) + 1)

  const uniqueCount = freq.size
  const maxRepeat = Math.max(...freq.values())

  return uniqueCount >= 6 && maxRepeat / chars.length <= 0.45
}

function hasWordDiversity(words: string[]): boolean {
  if (words.length === 0) return false
  const unique = new Set(words.map((w) => w.toLowerCase()))
  return unique.size / words.length >= 0.3
}

/**
 * Легитимный длинный аргумент — только после прохождения nonsense-фильтра.
 */
export function isDevelopedArgument(text: string): boolean {
  if (isNonsenseSpam(text)) return false

  const trimmed = text.trim()
  if (trimmed.length <= LONG_TEXT_THRESHOLD) return false

  const words = wordList(trimmed)
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()))
  if (uniqueWords.size < MIN_DEVELOPED_UNIQUE_WORDS) return false
  if (words.length < MIN_DEVELOPED_UNIQUE_WORDS) return false

  return hasCharacterDiversity(trimmed) && hasWordDiversity(words)
}

type ThoughtfulTopic =
  | 'price'
  | 'implementation'
  | 'trust'
  | 'security'
  | 'value'
  | 'generic'

function detectThoughtfulTopic(text: string): ThoughtfulTopic {
  const clean = normalize(text)
  if (/(цена|стоимост|окупа|roi|бюджет|потер|рубл)/.test(clean)) return 'price'
  if (/(внедрен|перенос|миграц|обучен|срок|перенести)/.test(clean)) return 'implementation'
  if (/(конкурент|1с|медодс|битрикс|альтернатив|amocrm|amo crm)/.test(clean)) return 'trust'
  if (/(данн|152|безопас|сервер|пдн|шифр)/.test(clean)) return 'security'
  if (/(эффект|результат|выгод|ценност|экономи)/.test(clean)) return 'value'
  return 'generic'
}

/** Вдумчивые открытия: клиент показывает, что услышал развёрнутый аргумент. */
const THOUGHTFUL_OPENERS = [
  'Звучит убедительно, но у меня остаётся вопрос',
  'Вижу, что вы глубоко погружены в тему, однако вопрос остаётся',
  'Аргументация весомая, и всё же не могу не спросить',
  'Ценю подробный ответ, но один момент всё ещё не закрыт',
  'Разложили по полочкам, принимаю. И всё же уточню',
]

const THOUGHTFUL_TAILS: Record<
  ThoughtfulTopic,
  { marina: string[]; artem: string[]; generic: string[] }
> = {
  price: {
    marina: [
      ' — во сколько это выльется за месяц с учётом двух кресел, и когда окупится?',
      ' — какая экономия в рублях на моих реальных объёмах, а не в теории?',
    ],
    artem: [
      ' — как считается ROI по сети из четырёх филиалов, а не по одной точке?',
      ' — есть ли формула окупаемости, которую я могу показать партнёру?',
    ],
    generic: [
      ' — во что это выльется по деньгам на моих объёмах?',
      ' — когда конкретно окупятся вложения?',
    ],
  },
  implementation: {
    marina: [
      ' — сколько реально займёт внедрение без остановки приёма пациентов?',
      ' — кто будет обучать администратора, если у неё и так нет времени?',
    ],
    artem: [
      ' — как внедрение пройдёт по всем четырём филиалам без простоя?',
      ' — сколько недель займёт перенос данных из текущей системы?',
    ],
    generic: [
      ' — сколько времени займёт внедрение на практике?',
      ' — что будет с текущими данными при переносе?',
    ],
  },
  trust: {
    marina: [
      ' — чем это принципиально лучше того, что нам уже предлагали?',
      ' — почему я должна менять то, что и так работает, пусть и не идеально?',
    ],
    artem: [
      ' — в чём дифференциатор относительно текущей системы, кроме цены?',
      ' — какие клиники нашего масштаба уже перешли и не пожалели?',
    ],
    generic: [
      ' — чем это лучше того, что у нас уже есть?',
      ' — какие есть примеры похожих клиник?',
    ],
  },
  security: {
    marina: [
      ' — где физически хранятся данные пациентов и кто имеет к ним доступ?',
      ' — что будет, если ваш сервер упадёт — мы потеряем всю историю?',
    ],
    artem: [
      ' — как обеспечивается 152-ФЗ при работе с несколькими филиалами?',
      ' — какие гарантии по безопасности данных вы даёте в договоре?',
    ],
    generic: [
      ' — как обеспечивается безопасность данных пациентов?',
      ' — что с соответствием 152-ФЗ?',
    ],
  },
  value: {
    marina: [
      ' — как это измерить в моих цифрах, а не в общих словах про эффективность?',
      ' — какой конкретно результат я увижу через месяц?',
    ],
    artem: [
      ' — как эту ценность посчитать по сети, а не на словах?',
      ' — какие метрики покажут результат руководству?',
    ],
    generic: [
      ' — как это скажется на моих конкретных показателях?',
      ' — какой результат я увижу первым?',
    ],
  },
  generic: {
    marina: [
      ' — что конкретно изменится в моей повседневной работе?',
      ' — с чего вы предлагаете начать, чтобы я не растерялась во всём этом?',
    ],
    artem: [
      ' — какой первый шаг вы предлагаете, чтобы не терять время?',
      ' — что от меня требуется на этом этапе?',
    ],
    generic: [
      ' — что конкретно нужно от меня, чтобы двигаться дальше?',
      ' — какой следующий шаг вы предлагаете?',
    ],
  },
}

function buildThoughtfulReply(
  topic: ThoughtfulTopic,
  clientId: string | undefined,
  used: string[],
): string {
  const tailsByPersona = THOUGHTFUL_TAILS[topic]
  const tails =
    clientId === 'marina'
      ? tailsByPersona.marina
      : clientId === 'artem'
        ? tailsByPersona.artem
        : tailsByPersona.generic

  const combos: string[] = []
  for (const opener of THOUGHTFUL_OPENERS) {
    for (const tail of tails) {
      combos.push(`${opener}${tail}`)
    }
  }

  const usedSet = new Set(used)
  const fresh = combos.filter((c) => !usedSet.has(c))
  const pool = fresh.length > 0 ? fresh : combos
  return pickRandom(pool)
}

function pickReplyForClient(
  intentId: string,
  basePool: string[],
  used: string[],
  clientId?: string,
  userText = '',
): string {
  const personaPool = getPersonaPool(clientId, intentId)
  // Качество важнее объёма: сначала персона, банк — только если релевантность высокая
  const combined = [...personaPool, ...basePool]

  if (userText.trim() && combined.length > 0) {
    const ranked = combined
      .map((reply) => ({ reply, score: relevanceScore(userText, reply) }))
      .sort((a, b) => b.score - a.score)
    const best = ranked[0]

    if (best && best.score >= 4) {
      const top = ranked.filter((r) => r.score >= best.score - 2).slice(0, 5)
      const personaHits = top.filter((t) => personaPool.includes(t.reply))
      const pickFrom =
        personaHits.length > 0 ? personaHits : top.slice(0, 3)
      const chosen = pickRandom(pickFrom).reply
      if (!used.includes(chosen)) return chosen
    }

    // Низкая релевантность → НЕ лезем в огромный банк, только персона / короткий fallback
    if (personaPool.length > 0) {
      return pickFreshReply(personaPool, used, userText)
    }
  }

  if (personaPool.length > 0) {
    return pickFreshReply(personaPool, used, userText)
  }
  // Банк — последний резерв, и только топ по релевантности
  return pickFreshReply(basePool, used, userText)
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
    case 'developed_argument':
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
    case 'nonsense_spam':
    case 'neutral_clarify':
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
    weight: 14,
    phrases: [
      'не звоните',
      'отстаньте',
      'достали',
      'это спам',
      'развод',
      'кидалово',
      'бред',
      'ерунда',
      'пошел в',
      'пошёл в',
      'ахуел',
      'охуел',
      'мудак',
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
  userText: string,
  scriptStep: number,
): string {
  const clean = normalize(userText)

  // В начале диалога «удобно минуту / добрый день / про запись» — это контакт, не боль
  if (
    scriptStep <= 2 &&
    /(удобно|минуту|есть время|добрый день|здравствуй|на связи)/.test(clean) &&
    !/(теря|заявк|журнал|excel|гигиен|окн|сколько стоит|дорого|демо)/.test(
      clean,
    )
  ) {
    return 'greeting'
  }

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

  if (
    recentOfftopic >= 3 &&
    (intentId === 'offtopic_confused' ||
      intentId === 'unknown' ||
      intentId === 'smalltalk_redirect')
  ) {
    return 'timing_busy'
  }

  if (hadPrice && intentId === 'price_inquiry') {
    return Math.random() < 0.55 ? 'price_objection' : 'value_challenge'
  }

  // Длинная нормальная фраза не должна уходить в «не поняла»
  if (
    intentId === 'offtopic_confused' &&
    clean.length >= 24 &&
    significantTokens(userText).length >= 3
  ) {
    if (/(недозвон|дозванив|дозвон|перезвон|звонк)/.test(clean)) {
      return 'need_discovery'
    }
    if (/(заявк|журнал|excel|гигиен|окн|запись|whatsapp)/.test(clean)) {
      return 'need_discovery'
    }
    return 'default_fallback' as string // handled specially below - use need_discovery soft
  }

  return intentId
}

/** Жёсткие ответы на типовые вопросы менеджера — приоритет над рандомом. */
const QA_PATTERNS: Array<{
  re: RegExp
  intentId: string
  marina: string[]
  artem: string[]
  generic: string[]
}> = [
  {
    re: /зафиксир|назначим\s+демо|давайте\s+демо|созвон|завтра\s+в|тестовый\s+(доступ|период)|пришлю\s+в\s+whatsapp|в\s+ватсап|слот\s|пилот\s+на/i,
    intentId: 'closing',
    marina: [
      'Ок. Пришлите в WhatsApp «демо ДентаCRM» — отвечу после приёмов.',
      'Давайте. Слот завтра после обеда, 15 минут, без слайдов.',
    ],
    artem: [
      'Присылайте КП и слот. С партнёром согласую на этой неделе.',
      'Ок, демо с партнёром. Пришлите календарь.',
    ],
    generic: ['Хорошо, давайте демо. Пришлите время и ссылку.'],
  },
  {
    re: /сколько\s*стоит|какая\s*цена|прайс|тариф|9900|девять\s*девять|подписка\s+от/i,
    intentId: 'price_inquiry',
    marina: [
      'Так, а сколько это в месяц за нашу клинику на два кресла?',
      'Назовите цифру целиком — что входит и сколько платить каждый месяц.',
    ],
    artem: [
      'Цена за четыре филиала? И есть ли опт за год?',
      'Вилка бюджета: от и до. Без «зависит».',
    ],
    generic: ['Озвучьте стоимость, чтобы понять, есть ли смысл продолжать.'],
  },
  {
    re: /дорого|не\s*потян|скидк|кусается/i,
    intentId: 'price_objection',
    marina: [
      'Дорого для клиники на два кресла. Нужен пилот или понятный расчёт потерь.',
      'Цена кусается. Покажите, где эти деньги вернутся.',
    ],
    artem: [
      'Дорого относительно рынка. Нужен ROI по филиалам.',
      'Без скидки на сеть даже КП не понесу на согласование.',
    ],
    generic: ['Дороговато. Нужно обоснование или спецусловия.'],
  },
  {
    re: /удобно|минуту|есть\s*время|не\s*отвлекаю/i,
    intentId: 'greeting',
    marina: [
      'Да, слушаю. Только коротко — пациент скоро.',
      'Минута есть. Давайте по делу.',
      'Говорите. Если про запись пациентов — я тут.',
    ],
    artem: [
      'Слушаю. Две минуты — и к сути.',
      'Да, удобно. Сразу дифференциатор, без воды.',
    ],
    generic: ['Да, слушаю. Давайте коротко.'],
  },
  {
    re: /журнал|excel|эксель|(ведёт|ведет)\s*запись|чем\s*вед|запис.*(whatsapp|ватсап|журнал)|whatsapp.*запис/i,
    intentId: 'need_discovery',
    marina: [
      'Запись в журнале, плюс WhatsApp у Ирины на телефоне. Excel тоже есть, но кривой.',
      'В основном бумажный журнал. WhatsApp — отдельно, иногда теряется.',
    ],
    artem: [
      'По филиалам по-разному: где-то 1С, где-то Excel. Единого контура нет.',
      'Запись размазана: телефония, таблицы, местами мессенджеры.',
    ],
    generic: ['Ведем в журнале и мессенджерах. Единой системы нет.'],
  },
  {
    re: /теря|заявк|не\s*перезвон|висят|лид|instagram|инстаграм/i,
    intentId: 'need_discovery',
    marina: [
      'Да, бывает — заявки из WhatsApp висят до вечера, Ирина не всегда перезванивает.',
      'Потери есть. Особенно вечером и из мессенджеров.',
    ],
    artem: [
      'Лиды на местах сливаются — без статусов и контроля не доказать.',
      'Да, пропущенные обращения по филиалам — главная боль.',
    ],
    generic: ['Да, заявки иногда теряются. Это больно.'],
  },
  {
    re: /недозвон|не\s*дозванив|не\s*дозвон|дозванива|не\s*доходят\s*звон/i,
    intentId: 'need_discovery',
    marina: [
      'Точную цифру не считала, но недозвоны каждую неделю есть — особенно в час пик.',
      'Бывает, что не дозваниваемся. Сколько раз — не веду учёт, вот в чём проблема.',
    ],
    artem: [
      'Конверсию звонок→запись не видим. Недозвоны точно есть, цифры нет.',
      'По сети это не меряем нормально — только жалобы управляющих.',
    ],
    generic: [
      'Недозвоны бывают. Точной статистики нет — руками не успеваем считать.',
    ],
  },
  {
    re: /гигиен|повторн|обзвон|возвращ/i,
    intentId: 'need_discovery',
    marina: [
      'На гигиену сами почти не возвращаются. Обзвон руками — никто не любит.',
      'Повторные визиты — слабое место. Напоминания шлём вручную, когда вспомним.',
    ],
    artem: [
      'Повторные визиты по филиалам не контролируем системно.',
      'Обзвон на местах хаотичный. Нужны автонапоминания и статусы.',
    ],
    generic: ['Повторные визиты проседают. Обзвон руками не тянем.'],
  },
  {
    re: /пуст.*окон|окон.*недел|свободн.*окн|дырк.*в\s*расписан/i,
    intentId: 'need_discovery',
    marina: [
      'Пустых окон после обеда хватает. Точную цифру в неделю не считала.',
      'Окна в 14:00 пустые, вечером очередь. Баланса нет.',
    ],
    artem: [
      'Пустые окна есть на всех точках, но единой картины по сети нет.',
      'Загрузка плавает. Без дашборда это ощущения, не цифры.',
    ],
    generic: ['Пустые окна бывают. Считаем примерно, не системно.'],
  },
  {
    re: /1с|медодс|манго|битрикс|чем\s+вы\s+лучше|конкурент|уже\s+есть\s+crm|сидим\s+на/i,
    intentId: 'trust_competitors',
    marina: [
      'Мы на журнале и Excel. Менять страшно — уже обжигались.',
      'Чем вы лучше того, что нам уже предлагали весной?',
    ],
    artem: [
      'У нас 1С и Манго. Переезд ради переезда неинтересен — в чём дифференциатор?',
      'Сравниваем с Медодс. Чем кардинально лучше для сети из 4 клиник?',
    ],
    generic: ['У нас уже есть система. Чем вы лучше?'],
  },
  {
    re: /партн[её]р|без\s+партн|лпр|собственник|я\s+не\s+решаю|руководств/i,
    intentId: 'authority_gate',
    marina: [
      'Без Ирины и без цифр потерь я сама ничего не внедрю.',
      'Финальное слово не только за мной. Нужны короткие материалы.',
    ],
    artem: [
      'Без партнёра на демо дальше не двигаемся. Пришлите one-pager для совета.',
      'Я собираю shortlist. Решение не только моё — нужен партнёр на линии.',
    ],
    generic: ['Я не единственный ЛПР. Нужны материалы для согласования.'],
  },
  {
    re: /конверси|сквозн\w*\s+аналитик|звонк\w*\s*(?:в\s+)?запис|из\s+звонка\s+в\s+запис/i,
    intentId: 'need_discovery',
    marina: [
      'Единой картины по конверсии звонок→запись нет — считаем на глаз.',
      'Управляющие смотрят каждый свой журнал, сводного отчёта нет. А как вы это сводите?',
    ],
    artem: [
      'По филиалам единой картины нет — управляющие смотрят каждый свой журнал, сводного отчёта нет. А как вы это сводите?',
      'Конверсию звонок→запись по точкам не видим. Это must-have.',
    ],
    generic: [
      'Сводного отчёта по конверсии нет — каждый смотрит свой кусок. А как вы это сводите?',
    ],
  },
  {
    re: /live|лайв|отч[её]т|дашборд|филиал/i,
    intentId: 'need_discovery',
    marina: [
      'Нормальной аналитики нет — решения больше по ощущениям.',
      'Сводного отчёта нет — смотрим кусками.',
    ],
    artem: [
      'Отчёты по филиалам собираем руками раз в месяц. Live-дашборда нет.',
      'По сети единой картины нет — только куски из точек.',
    ],
    generic: ['С аналитикой сейчас слабо. Нужны понятные цифры.'],
  },
]

function pickQaReply(
  userText: string,
  clientId: string | undefined,
  used: string[],
): { reply: string; intentId: string } | null {
  for (const pattern of QA_PATTERNS) {
    if (!pattern.re.test(userText)) continue
    const pool =
      clientId === 'marina'
        ? pattern.marina
        : clientId === 'artem'
          ? pattern.artem
          : pattern.generic
    return {
      intentId: pattern.intentId,
      reply: pickFreshReply(pool, used, userText),
    }
  }
  return null
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
  const clean = normalize(userText)

  // ── 1) NONSENSE / SPAM — до любого смысла, сюжет НЕ двигаем ──
  if (isNonsenseSpam(userText)) {
    return {
      intent: 'confused',
      reply: pickFreshReply(nonsenseRepliesFor(clientId), used, ''),
      nextStep: scriptStep,
      intentId: 'nonsense_spam',
    }
  }

  // ── 2) Хамство / мат ──
  if (isAggression(userText)) {
    const pool =
      AGGRESSION_REPLIES[clientId ?? ''] ?? AGGRESSION_REPLIES.generic
    return {
      intent: 'confused',
      reply: pickFreshReply(pool, used, userText),
      nextStep: scriptStep,
      intentId: 'aggression_pushback',
    }
  }

  // ── 3) Легитимный длинный аргумент (>120, ≥8 уникальных слов) ──
  if (isDevelopedArgument(userText)) {
    const topic = detectThoughtfulTopic(userText)
    const reply = buildThoughtfulReply(topic, clientId, used)
    const nextStep = Math.min(
      scriptStep + 1,
      Math.max(scenario.clientReplies.length, scriptStep + 1),
    )
    return {
      intent: 'objection',
      reply,
      nextStep,
      intentId: 'developed_argument',
    }
  }

  // ── 4) Паттерны / ключевые слова ──
  const qa = pickQaReply(userText, clientId, used)
  if (qa) {
    let nextStep = scriptStep
    if (qa.intentId === 'closing') nextStep = scenario.clientReplies.length
    else if (qa.intentId === 'greeting') nextStep = Math.max(scriptStep, 1)
    else if (qa.intentId === 'need_discovery') {
      nextStep = Math.min(
        scriptStep + 1,
        Math.max(scenario.clientReplies.length, scriptStep + 1),
      )
    }
    return {
      intent: mapToLegacyIntent(qa.intentId),
      reply: qa.reply,
      nextStep,
      intentId: qa.intentId,
    }
  }

  let { intentId } = detectIntentId(userText, scriptStep)
  intentId = refineIntentWithMemory(intentId, priorIds, userText, scriptStep)
  if (intentId === 'default_fallback') intentId = 'need_discovery'

  // Длинный осмысленный (уже не spam) текст почти никогда не «offtopic»
  if (
    intentId === 'offtopic_confused' &&
    clean.length >= 20 &&
    significantTokens(userText).length >= 2 &&
    countRealWordHits(wordList(userText)) >= 2
  ) {
    intentId = 'need_discovery'
  }

  if (clean.length < 4 || intentId === 'offtopic_confused') {
    const clarifyPool =
      NEUTRAL_CLARIFY_REPLIES[clientId ?? ''] ?? NEUTRAL_CLARIFY_REPLIES.generic
    return {
      intent: 'confused',
      reply: pickFreshReply(clarifyPool, used, ''),
      nextStep: scriptStep,
      intentId: intentId === 'offtopic_confused' ? 'offtopic_confused' : 'unknown',
    }
  }

  const intent = getIntentById(intentId)

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

  // Осмысленный текст без точного интента — нейтральное уточнение, НЕ реплика сценария
  const clarifyPool =
    NEUTRAL_CLARIFY_REPLIES[clientId ?? ''] ?? NEUTRAL_CLARIFY_REPLIES.generic
  return {
    intent: 'unknown',
    reply: pickFreshReply(clarifyPool, used, ''),
    nextStep: scriptStep,
    intentId: 'neutral_clarify',
  }
}
