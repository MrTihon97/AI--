import { TRAINING_DATA, type NluIntentId } from './training'

export type NluResult = {
  intentId: NluIntentId
  score: number
  /** вторичные кандидаты для отладки / аналитики */
  alternatives: Array<{ intentId: NluIntentId; score: number }>
}

const STOP = new Set([
  'это', 'как', 'что', 'или', 'для', 'про', 'вас', 'вам', 'наш', 'наши',
  'есть', 'было', 'будет', 'можно', 'нужно', 'скажите', 'минуту', 'пожалуйста',
  'и', 'а', 'но', 'же', 'бы', 'ли', 'не', 'на', 'по', 'из', 'от', 'до', 'за',
  'the', 'a', 'an', 'to', 'of', 'in', 'on',
])

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map((w) => (w.length > 6 ? w.slice(0, 6) : w))
}

type DocVec = Map<string, number>

function tf(tokens: string[]): DocVec {
  const m = new Map<string, number>()
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1)
  const n = tokens.length || 1
  for (const [k, v] of m) m.set(k, v / n)
  return m
}

function cosine(a: DocVec, b: DocVec): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [, v] of a) na += v * v
  for (const [, v] of b) nb += v * v
  if (na === 0 || nb === 0) return 0
  for (const [k, va] of a) {
    const vb = b.get(k)
    if (vb) dot += va * vb
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

type IndexedExample = {
  intentId: NluIntentId
  vec: DocVec
  tokens: string[]
}

let INDEX: IndexedExample[] | null = null
let IDF: Map<string, number> | null = null

function buildIndex(): void {
  const docs: IndexedExample[] = []
  const df = new Map<string, number>()

  for (const [intentId, phrases] of Object.entries(TRAINING_DATA) as Array<
    [NluIntentId, string[]]
  >) {
    for (const phrase of phrases) {
      const tokens = tokenize(phrase)
      const seen = new Set(tokens)
      for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1)
      docs.push({ intentId, tokens, vec: tf(tokens) })
    }
  }

  const N = docs.length
  const idf = new Map<string, number>()
  for (const [t, c] of df) {
    idf.set(t, Math.log(1 + N / (1 + c)))
  }

  for (const doc of docs) {
    for (const [t, v] of doc.vec) {
      doc.vec.set(t, v * (idf.get(t) ?? 1))
    }
  }

  INDEX = docs
  IDF = idf
}

function weightedVec(tokens: string[]): DocVec {
  if (!IDF) buildIndex()
  const base = tf(tokens)
  for (const [t, v] of base) {
    base.set(t, v * (IDF!.get(t) ?? 1))
  }
  return base
}

/** Эвристики поверх классификатора — жёсткие фразы + сленг. */
function ruleBoost(clean: string): Partial<Record<NluIntentId, number>> {
  const boost: Partial<Record<NluIntentId, number>> = {}
  const add = (id: NluIntentId, w: number) => {
    boost[id] = (boost[id] ?? 0) + w
  }

  if (
    /(добрый\s+день|доброе\s+утро|добрый\s+вечер|здравствуй|удобно|минут|приветик|привет|алло|ало|хай|хеллоу|салют)/.test(
      clean,
    )
  ) {
    add('greeting', 0.45)
  }
  if (
    /(сколько\s+стоит|какая\s+цена|прайс|тариф|стоим|чо\s+по\s+цен|чё\s+по\s+цен|почем|почём|скока|сколько\s+за\s+софт|ценник)/.test(
      clean,
    )
  ) {
    add('ask_price', 0.45)
  }
  if (/(дорого|не\s+потян|скидк)/.test(clean) && /(потер|окуп|неявк|roi|рубл)/.test(clean)) {
    add('price_defense', 0.5)
  }
  if (
    /(теря|заявк|неявк|журнал|excel|администратор|гигиен|пуст.*окн|недозвон|потер.*баз|клиентск|ручн\w*\s+ввод|забыт\w*\s+напоминан)/.test(
      clean,
    )
  ) {
    add('need_discovery', 0.4)
  }
  if (
    /(демо|zoom|зуум|пилот|созвон|слот|whatsapp.*ссыл|тестовый\s+доступ|созвонимся\s+на|на\s+10\s+минут|на\s+15\s+минут|\d{1,2}\s*[:.]\s*\d{2}|завтра\s+в|удобно\s+(в|завтра))/i.test(
      clean,
    )
  ) {
    add('closing', 0.55)
  }
  if (/(медодс|1с|1\s*с|инфодент|meddesk|икастом|клиника\s*365|битрикс|конкурент|чем\s+вы\s+лучше)/.test(clean))
    add('ask_competitors', 0.45)
  if (
    /(замен\w*|перейд\w*|вместо\s+ваш|снест\w*).{0,40}(1с|1\s*с|инфодент|мис|систем)/.test(
      clean,
    )
  ) {
    add('ask_competitors', 0.35)
  }
  if (
    /(интеграц|поверх\s+1с|в\s+связке|модул).{0,40}(1с|1\s*с|инфодент|мис)/.test(
      clean,
    )
  ) {
    add('value_pitch', 0.4)
    add('ask_competitors', 0.25)
  }
  if (/(внедрен|обучен|перенос|миграц)/.test(clean)) add('ask_implementation', 0.4)
  if (/(152|персональн|безопас|сервер)/.test(clean)) add('ask_security', 0.45)
  // «забытых напоминаний» — боль процесса, не продуктовый питч
  if (
    /(crm|дента|дашборд|модул|интеграц|автоматиз|автонапоминан)/.test(clean) ||
    (/(напоминан)/.test(clean) && !/забыт/.test(clean))
  ) {
    add('value_pitch', 0.35)
  }
  if (/(партн|лпр|собственник|не\s+решаю|руководств)/.test(clean)) add('authority', 0.4)
  if (/(подума|не\s+уверен|позже|не\s+сейчас)/.test(clean)) add('doubt', 0.35)
  if (/(занят|нет\s+времени|перезвон|пациент\s+ждет|на\s+прием)/.test(clean)) add('busy', 0.4)
  if (/(нахуй|нахер|мудак|дурак|отстань|спам)/.test(clean)) add('aggression', 0.8)
  if (/(как\s+дела|погода|футбол)/.test(clean)) add('smalltalk', 0.4)

  return boost
}

export type SalesStageHint =
  | 'intro'
  | 'discovery'
  | 'presentation'
  | 'objection'
  | 'closing'
  | 'ended'

/**
 * Multi-intent: если в фразе несколько сильных сигналов,
 * выбираем приоритет под текущий этап воронки.
 */
export function resolveMultiIntent(
  ranked: Array<{ intentId: NluIntentId; score: number }>,
  stage: SalesStageHint = 'intro',
  threshold = 0.35,
): NluIntentId {
  const strong = ranked.filter((r) => r.score >= threshold).slice(0, 4)
  if (strong.length <= 1) return ranked[0]?.intentId ?? 'clarify'

  const ids = new Set(strong.map((r) => r.intentId))
  const has = (id: NluIntentId) => ids.has(id)

  // Цена + демо в одной фразе
  if (has('ask_price') && has('closing')) {
    if (stage === 'intro' || stage === 'discovery') return 'need_discovery'
    if (stage === 'closing' || stage === 'objection' || stage === 'presentation') {
      return 'closing'
    }
    return 'closing'
  }

  // Цена названа + слот — закрытие важнее повторного торга
  if (has('closing') && (has('value_pitch') || has('ask_price') || has('price_defense'))) {
    if (stage === 'presentation' || stage === 'objection' || stage === 'closing') {
      return 'closing'
    }
  }

  // Discovery + цена
  if (has('need_discovery') && has('ask_price')) {
    if (stage === 'intro' || stage === 'discovery') return 'need_discovery'
    return 'ask_price'
  }

  // Discovery + питч-слова («напоминания») в ранней воронке → боль
  if (has('need_discovery') && has('value_pitch')) {
    if (stage === 'intro' || stage === 'discovery') return 'need_discovery'
    return 'value_pitch'
  }

  // Питч + закрытие
  if (has('value_pitch') && has('closing')) {
    if (stage === 'intro' || stage === 'discovery') return 'value_pitch'
    return 'closing'
  }

  // Возражение/защита цены vs закрытие
  if ((has('price_defense') || has('handle_objection')) && has('closing')) {
    return stage === 'closing' ? 'closing' : 'handle_objection'
  }

  // Приветствие + что-то ещё → не greeting после intro
  if (has('greeting') && strong.length > 1 && stage !== 'intro') {
    return strong.find((r) => r.intentId !== 'greeting')?.intentId ?? 'greeting'
  }

  return strong[0]!.intentId
}

/**
 * Классификатор намерений: TF-IDF + cosine + rule boost + multi-intent.
 */
export function classifyIntent(
  text: string,
  stage: SalesStageHint = 'intro',
): NluResult {
  if (!INDEX) buildIndex()

  const clean = normalize(text)
  const tokens = tokenize(text)

  if (!clean || tokens.length === 0) {
    return { intentId: 'nonsense', score: 1, alternatives: [] }
  }

  const q = weightedVec(tokens)
  const scores = new Map<NluIntentId, number>()

  for (const doc of INDEX!) {
    const s = cosine(q, doc.vec)
    if (s <= 0) continue
    scores.set(doc.intentId, Math.max(scores.get(doc.intentId) ?? 0, s))
  }

  const boosts = ruleBoost(clean)
  for (const [id, b] of Object.entries(boosts) as Array<[NluIntentId, number]>) {
    scores.set(id, (scores.get(id) ?? 0) + b)
  }

  if (
    text.trim().length > 120 &&
    tokens.length >= 8 &&
    (scores.get('value_pitch') ?? 0) < 0.55 &&
    (scores.get('need_discovery') ?? 0) < 0.5 &&
    (scores.get('ask_price') ?? 0) < 0.5
  ) {
    scores.set('value_pitch', Math.max(scores.get('value_pitch') ?? 0, 0.62))
  }

  const ranked = [...scores.entries()]
    .map(([intentId, score]) => ({ intentId, score }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  if (!best || best.score < 0.28) {
    return {
      intentId: 'clarify',
      score: best?.score ?? 0,
      alternatives: ranked.slice(0, 3),
    }
  }

  const resolved = resolveMultiIntent(ranked, stage)
  const resolvedScore =
    ranked.find((r) => r.intentId === resolved)?.score ?? best.score

  return {
    intentId: resolved,
    score: Number(resolvedScore.toFixed(3)),
    alternatives: ranked.filter((r) => r.intentId !== resolved).slice(0, 4),
  }
}

/** Прогрев индекса при старте приложения. */
export function warmNlu(): void {
  INDEX = null
  IDF = null
  buildIndex()
}
