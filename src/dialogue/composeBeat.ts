/**
 * Сборка реплики из слотов: Ack + Fact + (Ask | Statement).
 * Ack усиливается Active Listening / Emotion Inertia (beatPlanner).
 */
import type { Beat } from './beats'
import {
  extractCallerCompany,
  extractCallerFirstName,
  hasCallerIdentification,
  isChoiceOrOptionQuestion,
  isDirectWhQuestion,
  isFocusedDiagnosticAsk,
} from './beats'
import type { MentionedEntity } from './entities'
import {
  extractMentionedFigures,
  extractSlotTime,
  hasExplicitDateTimeSlot,
  mergeMentionedFigures,
  sessionHasFigures,
} from './entities'
import {
  hotKeywordTopic,
  slotsFor,
  type PersonaSlotBank,
  type SlotTopic,
} from './personaSlots'
import { filterUnusedPainFacts } from './painFacts'
import {
  ESSENCE_LOOP_RE,
  filterUnusedObjectionLines,
} from './objectionMemory'
import {
  buildActiveListeningAck,
  needsRestrainedAck,
  paceInterruptReply,
} from '../services/beatPlanner'
import {
  enforceVoiceGender,
  fillGender,
  voiceGenderForClient,
} from './gender'

export type ComposedBeat = {
  text: string
  askUsed: string | null
  hadAsk: boolean
  listeningAckUsed: string | null
  /** Этот ход узнал представление в Ack */
  introAcknowledged?: boolean
}

export type ComposeBeatOpts = {
  usedAsks?: string[]
  usedListeningAcks?: string[]
  entities?: MentionedEntity[]
  irritation?: number
  userText?: string
  clientId?: string
  /** Уже был greeting / opening — не повторять «Добрый день» */
  alreadyGreeted?: boolean
  /** Номер хода FSM (0 = первый ответ на реплику менеджера) */
  turn?: number
  /** Цифры, названные менеджером в этой сессии (+ текущий ход) */
  mentionedFigures?: string[]
  /** После contact_gate — сдержанный ответ, без глубокой уязвимости */
  postGateReserved?: boolean
  /** Уже раскрытые ключи болей — антиповтор */
  usedPainFacts?: string[]
  /** Уже показанные типы возражений */
  usedObjections?: string[]
  /** Менеджер уже представился (слот FSM) */
  hasIntroduced?: boolean
  /** Клиент уже узнал представление хотя бы раз */
  introAcknowledged?: boolean
  /** Имя менеджера из прошлых ходов */
  managerName?: string | null
  /** Компания менеджера из прошлых ходов */
  managerCompany?: string | null
}

/** Мета-фразы про ключевые слова — вычищаем из выдачи. */
export const META_PHRASE_RE =
  /^(про\s+\S.{0,48}(зацепило|понял[аи]?|услышал[аи]?|это\s+наше)|если\s+(про|говорить\s+именно\s+про)\s+|ок,?\s+фиксирую:\s+речь\s+про|тема\s+\S+\s+близкая|да,?\s+\S+\s+у\s+нас\s+(знакомая\s+боль|как\s+раз\s+больн))/i

const DEEP_VULN_RE =
  /тонем|стыдно|сгорают\s+до\s+вечера|знакомая\s+боль|дыры\s+хватает|постоянная\s+дыра|без\s+системы\s+реально/i

/** Скептические филлеры — запрещены на прямых WH / choice-вопросах. */
const SKEPTICAL_FILLER_RE =
  /\b(ну,?\s*)?(допустим|положим)([.,…!]|\s|$)/i

const BANNED_DRAMA_RE =
  /тут\s+без\s+системы\s+реально\s+тонем\.?\s*/gi

function stripBannedDrama(text: string): string {
  return text
    .replace(BANNED_DRAMA_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim()
}

function stripSkepticalFillers(text: string): string {
  let t = text.trim()
  // Ведущий филлер: «Ну, допустим. …»
  t = t.replace(
    /^(ну,?\s*)?(допустим|положим)([.,…!]?\s*)+/i,
    '',
  )
  // «ДентаCRM? Ну, допустим.» → «ДентаCRM?»
  t = t.replace(
    /(\S\?)\s*(ну,?\s*)?(допустим|положим)([.,…!]?\s*)+/i,
    '$1 ',
  )
  return t.replace(/\s{2,}/g, ' ').trim()
}

function reservedWarmAck(
  userText: string,
  used: string[],
  opts: ComposeBeatOpts = {},
): string {
  const intro = buildIntroAcknowledgement(userText, used, opts)
  if (intro.text) return intro.text
  return pick(['Ладно, слушаю.', 'Ок, по делу.'], used)
}

/**
 * Топик факта: hot-keyword побеждает generic beat.topic —
 * но только после представления (иначе «Сколько…» → price leak).
 */
function resolveFactTopic(
  beatTopic: SlotTopic,
  userText: string | undefined,
  opts: ComposeBeatOpts = {},
): SlotTopic {
  const introduced =
    Boolean(opts.hasIntroduced) ||
    Boolean(opts.introAcknowledged) ||
    (userText ? hasCallerIdentification(userText) : false)
  if (!introduced) return 'generic'
  const hot = userText ? hotKeywordTopic(userText) : null
  if (hot) return hot
  return beatTopic
}

/**
 * Персональный Ack на представление (имя / компания).
 * Не прыгаем сразу в «Ирина не перезванивает» без узнавания.
 */
function buildIntroAcknowledgement(
  userText: string,
  used: string[],
  opts: ComposeBeatOpts = {},
): { text: string; hasAsk: boolean } {
  const name =
    extractCallerFirstName(userText) ?? opts.managerName ?? null
  const company =
    extractCallerCompany(userText) ?? opts.managerCompany ?? null
  const identified =
    hasCallerIdentification(userText) ||
    Boolean(opts.hasIntroduced && (name || company))

  if (!identified && !name && !company) {
    return { text: '', hasAsk: false }
  }

  const hasDiag =
    isChoiceOrOptionQuestion(userText) ||
    isDirectWhQuestion(userText) ||
    isFocusedDiagnosticAsk(userText)

  if (name) {
    if (hasDiag) {
      return {
        text: pick(
          [
            `А, ${name}, понял вас. Дальше коротко по делу.`,
            `Слушаю вас, ${name}. По вашему вопросу — коротко.`,
            `Понятно, ${name}. Слушаю дальше по делу.`,
          ],
          used,
        ),
        hasAsk: false,
      }
    }
    return {
      text: pick(
        [
          `А, ${name}, приятно. Так что там с вашей системой?`,
          `Слушаю вас, ${name}. Что за система?`,
          `Понятно, ${name}. Слушаю вас дальше по делу.`,
          `${name}, приятно. Ок — слушаю, с чего начнём?`,
        ],
        used,
      ),
      hasAsk: true,
    }
  }

  if (company) {
    if (hasDiag) {
      return {
        text: pick(
          [
            `${company}? Ладно, слушаю по делу.`,
            `Ок, ${company} — дальше коротко.`,
          ],
          used,
        ),
        hasAsk: false,
      }
    }
    return {
      text: pick(
        [
          `${company}? Приятно. Так что там с вашей системой?`,
          `Ок, ${company}. Слушаю вас дальше по делу.`,
        ],
        used,
      ),
      hasAsk: true,
    }
  }

  if (hasDiag) {
    return {
      text: pick(
        ['Ок, представились — слушаю дальше.', 'Понятно. Слушаю по делу.'],
        used,
      ),
      hasAsk: false,
    }
  }
  return {
    text: pick(
      [
        'Ок, представились. Так что там с вашей системой?',
        'Понятно. Слушаю вас дальше по делу.',
      ],
      used,
    ),
    hasAsk: true,
  }
}

/**
 * Лёгкое зеркало имени в Ack на последующих ходах (после introAcknowledged).
 */
function mirrorNameIntoAck(
  base: string,
  opts: ComposeBeatOpts,
): string {
  const name = opts.managerName?.trim()
  if (!name || !opts.hasIntroduced || !opts.introAcknowledged) return base
  if (new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(base)) {
    return base
  }
  // Не каждый ход — только если base короткий line-ack
  if (!/^(да[,.]?\s*)?(на\s+линии|слышу|слушаю|на\s+связи|ок|ладно|понял[аи]?)\.?$/i.test(
    base.trim(),
  )) {
    return base
  }
  return pick(
    [
      `Слушаю вас, ${name}.`,
      `А, ${name}, понял вас.`,
      `${name}, ок — дальше по делу.`,
    ],
    opts.usedListeningAcks ?? [],
  )
}

/** Сдержанный факт после gate / intro — без глубокой уязвимости. */
function reservedFact(
  topic: SlotTopic,
  clientId: string | undefined,
  used: string[],
  usedPainFacts?: string[],
): string {
  const marina = [
    'У нас Ирина всё вручную в WhatsApp пишет, на завалах не успевает.',
    'Запись ведём руками — журнал и мессенджеры, без единого контура.',
    'Администратор тянет запись сама, автоматизации почти нет.',
  ]
  const artem = [
    'По филиалам запись сводим криво — единого контура нет.',
    'На точках кто в Excel, кто в мессенджерах — свода мало.',
    'Контроль администраторов по сети пока ручной.',
  ]
  const generic = [
    'Запись у нас в основном руками, без единого контура.',
    'Процесс живой, но дыр хватает — без драмы.',
  ]
  const byTopic: Partial<Record<SlotTopic, string[]>> = {
    whatsapp: [
      'У нас Ирина всё вручную в WhatsApp пишет, на завалах не успевает.',
      'WhatsApp у администратора на телефоне — вечером часто висит.',
      'У нас всё в WhatsApp на телефоне администратора. Вечером чаты висят, да, только утром разбираем.',
    ],
    conversion: [
      'Единой картины по конверсии нет — смотрим кусками.',
      'Сводного отчёта по точкам пока нет.',
    ],
    journal: [
      'Запись ведём руками — журнал и куски в Excel.',
      'Бумажный журнал ещё жив, да.',
      'Учёт в Excel и привычках — единого контура нет.',
    ],
    price: [
      'Для двух кресел любая подписка ощутима.',
      'Бюджет считаем жёстко — без картины потерь цифра «просто дорого».',
    ],
    admin: [
      'CRM как единой системы у нас нет — куски в Excel и WhatsApp.',
      'Про CRM: единого контура нет, всё разъехалось по привычкам.',
    ],
    losses: marina,
  }
  const pool =
    byTopic[topic] ??
    (clientId === 'artem' ? artem : clientId === 'marina' ? marina : generic)
  const mild = pool.filter((p) => !DEEP_VULN_RE.test(p))
  return pick(mild.length > 0 ? mild : pool, used, usedPainFacts)
}

function choiceAlignedFact(
  userText: string,
  clientId: string | undefined,
  used: string[],
  usedPainFacts?: string[],
): string {
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  const whatsappFirst = /(whatsapp|ватсап|вотсап|мессенджер)/i.test(t)
  const journalFirst = /(журнал|excel|эксель|тетрад|бумаг)/i.test(t)

  if (clientId === 'artem') {
    if (whatsappFirst && journalFirst) {
      return pick(
        [
          'По точкам по-разному: где WhatsApp у администратора, где Excel — единого контура нет.',
          'Часть филиалов в мессенджерах, часть в Excel. Свода по сети мало.',
        ],
        used,
        usedPainFacts,
      )
    }
    if (whatsappFirst) {
      return pick(
        [
          'Мессенджеры по филиалам не сведены в одну картину.',
          'WhatsApp у администраторов без единого контроля по сети.',
        ],
        used,
        usedPainFacts,
      )
    }
    return pick(
      [
        'На точках кто в Excel, кто в журнале — единого стандарта нет.',
        'Фиксируем в Excel и привычках филиалов, свода мало.',
      ],
      used,
      usedPainFacts,
    )
  }

  if (whatsappFirst) {
    return pick(
      [
        'У нас всё в WhatsApp на телефоне администратора. Вечером чаты висят, да, только утром разбираем.',
        'Сейчас в основном WhatsApp у администратора на телефоне — журнал рядом, но мессенджер главный.',
        'Ведём в WhatsApp на телефоне администратора. Журнал есть, но дожимает она из чатов.',
      ],
      used,
      usedPainFacts,
    )
  }
  if (journalFirst) {
    return pick(
      [
        'В основном бумажный журнал, плюс куски в Excel.',
        'Запись в журнале. Excel тоже есть, но кривой.',
        'Бумажный журнал ещё жив — WhatsApp отдельно, когда успеваем.',
      ],
      used,
      usedPainFacts,
    )
  }
  return pick(
    [
      'Запись ведём руками — журнал и мессенджеры, без единого контура.',
      'Администратор тянет запись сама, автоматизации почти нет.',
    ],
    used,
    usedPainFacts,
  )
}

/** Реакция на презентацию менеджера — без боли и без «Ок, слушаю». */
const POST_PITCH_REACT: Record<string, string[]> = {
  marina: [
    'А сколько это стоит?',
    'У меня нет времени на Zoom, пришлите КП.',
    'Ну давайте завтра глянем, если 10 минут.',
    'Ок, вилку по цене назовите — без демо пока.',
    'Если коротко по цифрам — сколько в месяц на два кресла?',
    'Завтра после обеда удобнее, чем утром — подойдёт?',
  ],
  artem: [
    'А какая вилка по сети на точку?',
    'Zoom сейчас не тяну — пришлите КП и критерии окупаемости.',
    'Ну давайте 10 минут завтра — без слайдов, сразу по своду.',
    'Сколько это в месяц на филиал, без «от»?',
    'Слот после 15:00 реалистичнее — зафиксируем?',
  ],
  generic: [
    'А сколько это стоит?',
    'У меня нет времени на Zoom, пришлите КП.',
    'Ну давайте завтра глянем, если 10 минут.',
  ],
}

/** После отработанного «в чём суть?» + слот — accept / counter / price. */
const POST_RESOLVED_SLOT: Record<string, string[]> = {
  marina: [
    'Договорились, давайте короткий созвон — пришлите слот в WhatsApp.',
    'Завтра после обеда мне удобнее — какой точный час?',
    'Ок по слоту. А сколько это в месяц на два кресла?',
    'Принимаю 10 минут. Ссылку жду в WhatsApp.',
  ],
  artem: [
    'Ок, 10 минут принимаю — ссылку в WhatsApp.',
    'Слот после 15:00 реалистичнее. Подтвердите час.',
    'Слот услышал. Какая вилка на точку в месяц?',
  ],
  generic: [
    'Ок, слот принимаю — пришлите ссылку.',
    'Завтра после обеда удобнее. Какой час?',
    'А сколько это стоит — до созвона?',
  ],
}

function postPitchReactLine(
  clientId: string | undefined,
  used: string[],
  usedObjections?: string[],
): string {
  const pool =
    (clientId && POST_PITCH_REACT[clientId]) || POST_PITCH_REACT.generic!
  const filtered = filterUnusedObjectionLines(pool, usedObjections)
  return pick(filtered, used)
}

function postResolvedSlotLine(
  clientId: string | undefined,
  used: string[],
): string {
  const pool =
    (clientId && POST_RESOLVED_SLOT[clientId]) || POST_RESOLVED_SLOT.generic!
  return pick(pool, used)
}

function reservedAsk(usedAsks: string[]): string {
  return pick(
    [
      'А у вас что за система?',
      'И что именно предлагаете посмотреть?',
      'Чем хотите помочь — коротко?',
    ],
    usedAsks,
  )
}

/** Срезает ведущие мета-фразы про ключевые слова. */
function stripMetaLead(text: string): string {
  let t = text.trim()
  if (!t) return t
  const first = t.split(/(?<=[.!?…])\s+/)[0] ?? t
  if (
    META_PHRASE_RE.test(first) ||
    /зацепило|фиксирую:\s*речь|тема\s+\S+\s+близкая|если\s+говорить\s+именно\s+про/i.test(
      first,
    )
  ) {
    t = t.slice(first.length).trim()
  }
  return t || text.trim()
}

/** Выдуманный контекст / самозакрытие — нельзя на ранних ходах */
const EARLY_HALLUCINATION =
  /(партн[её]р|проседают|проверю на (наших|своих) цифр|цифру партн|гипотез\w* — проверю|без единой цифры сравнивать бессмысленно|партнёр будет спрашивать)/i

function pickSafe(
  pool: string[],
  used: string[],
  earlyTurn: boolean,
  usedPainFacts?: string[],
): string {
  const filtered = earlyTurn
    ? pool.filter((p) => !EARLY_HALLUCINATION.test(p))
    : pool
  const base = filtered.length > 0 ? filtered : pool
  return pick(base, used, usedPainFacts)
}

function timeFrameAck(clientId: string | undefined, used: string[]): string {
  const pool =
    clientId === 'artem'
      ? [
          'Да, пару минут есть.',
          'Да, две минуты есть — по делу.',
          'Минуты есть. Слушаю.',
        ]
      : [
          'Да, пару минут есть.',
          'Да, удобно коротко.',
          'Минуту-две есть — слушаю.',
        ]
  return pick(pool, used)
}

function frameAsk(clientId: string | undefined, usedAsks: string[]): string {
  const pool =
    clientId === 'artem'
      ? [
          'Что именно сравниваете по сети?',
          'По каким критериям смотрите решения?',
          'Что для вас главный критерий сравнения?',
        ]
      : [
          'Что именно хотите обсудить за эти минуты?',
          'С чего начнём — боль или сравнение?',
          'Какой один вопрос сейчас главный?',
        ]
  return pick(pool, usedAsks)
}

function pick(
  pool: string[],
  used: string[],
  usedPainFacts?: string[],
): string {
  if (pool.length === 0) return ''
  const filtered = filterUnusedPainFacts(pool, usedPainFacts, used)
  const list = filtered.length > 0 ? filtered : pool
  const fresh = list.filter((r) => !used.includes(r))
  const final = fresh.length > 0 ? fresh : list
  return final[Math.floor(Math.random() * final.length)]!
}

function topicPool(
  map: Record<SlotTopic, string[]>,
  topic: SlotTopic,
): string[] {
  const primary = map[topic] ?? []
  if (primary.length >= 2) return primary
  return [...primary, ...(map.generic ?? [])]
}

function joinParts(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NONSENSE: Record<string, string[]> = {
  marina: [
    'Извините, я не совсем {понял}, что вы имеете в виду.',
    'Связь нормальная? Сформулируйте одним предложением, пожалуйста.',
    'Это мимо. Давайте по записи пациентов — коротко.',
  ],
  artem: [
    'Не понял. Одной фразой — что предлагаете.',
    'Это не похоже на предложение. Сформулируйте по существу.',
  ],
  generic: ['Не совсем {понял}. Повторите по делу, пожалуйста.'],
}

const AGGRESSION: Record<string, string[]> = {
  marina: [
    'Так разговаривать не будем. Либо по делу — либо кладу трубку.',
    'Хамство не слушаю. Если есть нормальный вопрос — говорите.',
  ],
  artem: [
    'Так разговаривать не будем. Вернётесь по делу — поговорим.',
    'Хамство мимо. Есть деловое предложение — одно предложение.',
  ],
  generic: ['Давайте без грубости. Либо по делу, либо до свидания.'],
}

function poolFor(
  clientId: string | undefined,
  map: Record<string, string[]>,
): string[] {
  if (clientId && map[clientId]) return map[clientId]!
  return map.generic ?? ['…']
}

function baseAckForBeat(
  beat: Beat,
  bank: PersonaSlotBank,
  used: string[],
): string {
  switch (beat.id) {
    case 'intro_open':
    case 'intro_hello':
      return pick(bank.helloAcks, used)
    case 'intro_frame':
      return pick(bank.lineAcks, used)
    case 'line_ping':
    case 'busy':
      return pick(bank.lineAcks, used)
    case 'price_stated':
      return pick(bank.priceStatedAcks, used)
    case 'price_early':
      return pick(bank.earlyPriceAcks, used)
    case 'closing_ok':
    case 'closing_confirm':
    case 'closing_need_slot':
      return pick(bank.closingAcks, used)
    case 'closing_early':
      return pick(bank.closingEarlyAcks, used)
    case 'pitch':
      return pick(bank.pitchAcks, used)
    case 'persona_pushback':
    case 'objection_busy':
    case 'objection_skepticism':
      return pick(bank.pushbackAcks, used)
    case 'legacy_crm':
      return pick(bank.legacyCrmPushedAcks, used)
    case 'legacy_crm_discovery':
      return pick(bank.legacyCrmDiscoveryAcks, used)
    case 'legacy_replacement_error':
      return pick(bank.replacementErrorAcks, used)
    case 'legacy_integration_ok':
      return pick(bank.integrationGoodAcks, used)
    default:
      return pick(bank.lineAcks, used)
  }
}

function ackForBeat(
  beat: Beat,
  bank: PersonaSlotBank,
  used: string[],
  opts: ComposeBeatOpts,
): { ack: string; listeningAckUsed: string | null } {
  const base = baseAckForBeat(beat, bank, used)
  const irritation = opts.irritation ?? 0

  // Closing / intro_open / intro_frame / contact_gate — свой ack
  if (
    beat.id === 'intro_open' ||
    beat.id === 'intro_frame' ||
    beat.id === 'contact_gate' ||
    beat.id === 'closing_ok' ||
    beat.id === 'closing_early' ||
    beat.id === 'closing_confirm' ||
    beat.id === 'closing_need_slot' ||
    beat.id === 'pace_interrupt' ||
    beat.id === 'persona_pushback' ||
    beat.id === 'objection_busy' ||
    beat.id === 'objection_skepticism' ||
    beat.id === 'legacy_crm' ||
    beat.id === 'legacy_crm_discovery' ||
    beat.id === 'legacy_replacement_error' ||
    beat.id === 'legacy_integration_ok'
  ) {
    return { ack: base, listeningAckUsed: null }
  }

  // Повторный hello после opening — без «Добрый день», короткий line ack
  if (beat.id === 'intro_hello' && opts.alreadyGreeted) {
    const soft = pick(
      ['Слушаю.', 'На связи.', 'Да.', 'Слышу.'],
      used,
    )
    return { ack: soft || base, listeningAckUsed: null }
  }
  if (beat.id === 'intro_hello') {
    return { ack: base, listeningAckUsed: null }
  }

  const usedListening = opts.usedListeningAcks ?? []
  const preferSkip = usedListening.length > 0

  // Listening по «цене» только на price-битах (иначе «подписка/10-20%» ломает discovery)
  const priceBeats = new Set(['price_stated', 'price_early', 'price_discuss'])
  let ents = opts.entities ?? []
  if (!priceBeats.has(beat.id)) {
    ents = ents.filter((e) => e !== 'цена')
  }
  // Конверсия / филиалы — не клеить «Про потери поняла»
  if (beat.topic === 'conversion') {
    ents = ents.filter((e) => e !== 'потери')
  }
  // На discovery/pitch не цепляем цену вообще
  if (
    beat.id === 'discovery_pain' ||
    beat.id === 'pitch' ||
    beat.policyId === 'beat:intro_substance'
  ) {
    ents = ents.filter((e) => e !== 'цена')
  }

  if (needsRestrainedAck(irritation)) {
    const ack = buildActiveListeningAck(ents, {
      irritation,
      used: usedListening,
      fallbackAck: base,
      preferSkip: false,
      clientId: opts.clientId,
    })
    return {
      ack,
      listeningAckUsed: ack !== base ? ack : null,
    }
  }

  const listening = buildActiveListeningAck(ents, {
    irritation: 0,
    used: usedListening,
    fallbackAck: '',
    preferSkip,
    clientId: opts.clientId,
  })
  if (listening) {
    return {
      ack: mirrorNameIntoAck(listening, opts),
      listeningAckUsed: listening,
    }
  }

  return { ack: mirrorNameIntoAck(base, opts), listeningAckUsed: null }
}

function askForBeat(
  beat: Beat,
  bank: PersonaSlotBank,
  usedAsks: string[],
  opts: ComposeBeatOpts = {},
): string {
  const hasFigs = sessionHasFigures(opts.mentionedFigures, opts.userText)
  const filterFigs = (pool: string[]) =>
    hasFigs
      ? pool
      : pool.filter(
          (p) =>
            !/цифр|тысяч|₽|руб|стоить|цен[аы]|экономик|\broi\b|рубль/i.test(p),
        )

  switch (beat.id) {
    case 'intro_open':
    case 'intro_hello':
      return pick(bank.helloAsks, usedAsks)
    case 'intro_frame':
      return frameAsk(undefined, usedAsks)
    case 'line_ping':
      return pick(
        [
          'Коротко — о чём речь?',
          'Давайте по делу: что хотели обсудить?',
          'Слушаю. Какой вопрос?',
        ],
        usedAsks,
      )
    case 'busy':
      return pick(
        ['Тезис в одном предложении?', 'Сорок секунд — что главное?'],
        usedAsks,
      )
    case 'price_early':
      return pick(bank.earlyPriceAsks, usedAsks)
    case 'closing_early':
      return pick(bank.closingEarlyAsks, usedAsks)
    case 'closing_ok':
      return pick(bank.asks.demo, usedAsks)
    case 'pitch':
      return pick(filterFigs(bank.pitchAsks), usedAsks)
    case 'persona_pushback':
      return pick(
        filterUnusedObjectionLines(
          filterFigs(bank.pushbackAsks),
          opts.usedObjections,
        ),
        usedAsks,
      )
    case 'legacy_crm':
      return pick(
        filterUnusedObjectionLines(
          filterFigs(bank.legacyCrmPushedAsks),
          opts.usedObjections,
        ),
        usedAsks,
      )
    case 'legacy_crm_discovery':
      return pick(filterFigs(bank.legacyCrmDiscoveryAsks), usedAsks)
    case 'legacy_replacement_error':
      return pick(
        filterUnusedObjectionLines(
          filterFigs(bank.replacementErrorAsks),
          opts.usedObjections,
        ),
        usedAsks,
      )
    case 'legacy_integration_ok':
      return pick(filterFigs(bank.integrationGoodAsks), usedAsks)
    case 'clarify':
      return pick(bank.asks.generic, usedAsks)
    default:
      return pick(filterFigs(topicPool(bank.asks, beat.topic)), usedAsks)
  }
}

function statementForBeat(
  beat: Beat,
  bank: PersonaSlotBank,
  used: string[],
  earlyTurn = false,
  opts: ComposeBeatOpts = {},
): string {
  const pain = opts.usedPainFacts
  const hasFigs = sessionHasFigures(opts.mentionedFigures, opts.userText)
  const filterFigs = (pool: string[]) =>
    hasFigs
      ? pool
      : pool.filter(
          (p) =>
            !/цифр|тысяч|₽|руб|стоить|цен[аы]|экономик|\broi\b|рубль/i.test(p),
        )

  if (beat.id === 'post_pitch') {
    // После essence + предложение слота → accept/counter/price, не «суть»
    if (
      (opts.usedObjections ?? []).includes('GIVE_ESSENCE') ||
      (opts.userText &&
        /(zoom|зуум|демо|завтра|слот|\d{1,2}\s*[:.]\s*\d{2})/i.test(
          opts.userText,
        ))
    ) {
      return postResolvedSlotLine(opts.clientId, used)
    }
    return postPitchReactLine(opts.clientId, used, opts.usedObjections)
  }
  if (beat.id === 'closing_ok' || beat.id === 'closing_confirm' || beat.id === 'closing_need_slot') {
    return pick(bank.closingStatements, used)
  }
  if (beat.id === 'pitch') {
    return pickSafe(filterFigs(bank.pitchStatements), used, earlyTurn, pain)
  }
  if (beat.id === 'price_early' || beat.id === 'closing_early') {
    return pickSafe(topicPool(bank.statements, beat.topic), used, earlyTurn, pain)
  }
  if (beat.id === 'line_ping' || beat.id === 'clarify' || beat.id === 'busy') {
    return pick(bank.statements.generic, used)
  }
  if (beat.id === 'persona_pushback') {
    const pool = filterUnusedObjectionLines(
      filterFigs(bank.pushbackStatements),
      opts.usedObjections,
    )
    return pick(pool.length > 0 ? pool : filterFigs(bank.pushbackStatements), used)
  }
  if (beat.id === 'legacy_crm') {
    const pool = filterUnusedObjectionLines(
      filterFigs(bank.legacyCrmPushedStatements),
      opts.usedObjections,
    )
    return pick(
      pool.length > 0 ? pool : filterFigs(bank.legacyCrmPushedStatements),
      used,
    )
  }
  if (beat.id === 'legacy_replacement_error') {
    const pool = filterUnusedObjectionLines(
      filterFigs(bank.replacementErrorStatements),
      opts.usedObjections,
    )
    return pick(
      pool.length > 0 ? pool : filterFigs(bank.replacementErrorStatements),
      used,
    )
  }
  if (beat.id === 'legacy_integration_ok') {
    return pick(filterFigs(bank.integrationGoodStatements), used)
  }
  if (beat.id === 'objection_busy') {
    if (hasFigs) {
      const fig =
        (opts.mentionedFigures && opts.mentionedFigures[0]) ||
        'названной сумме'
      const priced = filterUnusedObjectionLines(
        [
          `Подождите с Zoom, у меня через минуту пациент. Вы мне сначала скажите, откуда цифра в ${fig}?`,
          `Подождите, какой Zoom? У меня приём через две минуты. Вы мне сначала в двух словах скажите, откуда ${fig}?`,
        ],
        opts.usedObjections,
      )
      return pick(priced, used)
    }
    // После GIVE_ESSENCE — не «сначала суть»
    if (
      (opts.usedObjections ?? []).includes('GIVE_ESSENCE') ||
      (opts.usedObjections ?? []).includes('PATIENT_IN_CHAIR')
    ) {
      return postResolvedSlotLine(opts.clientId, used)
    }
    const busyPool = filterUnusedObjectionLines(
      [
        'Подождите с Zoom, у меня через минуту пациент. Сейчас не до демо — сначала коротко, зачем звоните.',
        'Подождите, какой Zoom? У меня приём через две минуты. Без срочности на слот не пойду — тезис одним предложением.',
        'Секунду с Zoom. У меня пациент, времени мало: сначала суть звонка, потом решим про слот.',
      ],
      opts.usedObjections,
    )
    const cleaned = busyPool.filter((l) => !ESSENCE_LOOP_RE.test(l))
    const pool =
      cleaned.length > 0
        ? cleaned
        : [
            'Zoom сейчас не тяну — пришлите КП, гляну после приёмов.',
            'Слот после обеда реалистичнее. А вилку по цене назовите?',
          ]
    return pick(pool, used)
  }
  if (beat.id === 'objection_skepticism') {
    if (hasFigs) {
      const fig =
        (opts.mentionedFigures && opts.mentionedFigures[0]) ||
        'этих цифр'
      return pick(
        [
          `Откуда ${fig} — пока звучит как общие оценки. Без экономики на Zoom не пойду.`,
          `Цифру ${fig} услышала, но источник неясен. На Zoom без пояснения не пойду.`,
        ],
        used,
      )
    }
    return pick(
      [
        'Подождите с Zoom — сначала пойму, зачем нам это, без демо «на всякий случай».',
        'На Zoom рано. У меня мало времени: тезис одним предложением, потом решим про слот.',
        'Секунду. Слот без понятной повестки для меня пустая трата — сначала суть.',
      ],
      used,
    )
  }
  return pickSafe(topicPool(bank.statements, beat.topic), used, earlyTurn, pain)
}

function factForBeat(
  beat: Beat,
  bank: PersonaSlotBank,
  used: string[],
  earlyTurn = false,
  usedPainFacts?: string[],
  opts: ComposeBeatOpts = {},
): string {
  if (beat.id === 'price_stated') {
    return pickSafe(topicPool(bank.facts, 'price'), used, earlyTurn, usedPainFacts)
  }
  if (beat.id === 'legacy_crm_discovery') {
    return pick(bank.legacyCrmDiscoveryFacts, used)
  }
  const topic = resolveFactTopic(beat.topic, opts.userText, opts)
  const pool = topicPool(bank.facts, topic).filter(
    (p) => !DEEP_VULN_RE.test(p),
  )
  return pickSafe(
    pool.length > 0 ? pool : topicPool(bank.facts, topic),
    used,
    earlyTurn,
    usedPainFacts,
  )
}

function stripSecondaryGreeting(text: string, alreadyGreeted: boolean): string {
  if (!alreadyGreeted || !text) return text
  let t = text.trim()
  // «Добрый день.» / «Да, добрый день.» / «Здравствуйте.» в начале
  t = t.replace(
    /^(да[,.]?\s*)?(добрый\s+день|добрый\s+вечер|доброе\s+утро|здравствуйте|добрый)[.!,…]?\s+/i,
    '',
  )
  // Если осталась одна точка после вырезания
  t = t.replace(/^\s*[.!,…]+\s*/, '').trim()
  return t || text.trim()
}

function voiceOut(
  text: string,
  clientId?: string,
  alreadyGreeted?: boolean,
): string {
  const g = voiceGenderForClient(clientId)
  let t = fillGender(text, g)
  if (g === 'm') t = enforceVoiceGender(t, 'm')
  t = stripSecondaryGreeting(t, Boolean(alreadyGreeted))
  return t
}

export function composeBeatReply(
  beat: Beat,
  clientId: string | undefined,
  usedReplies: string[],
  opts: ComposeBeatOpts | string[] = {},
): ComposedBeat {
  const normalized: ComposeBeatOpts = Array.isArray(opts)
    ? { usedAsks: opts, clientId }
    : { ...opts, clientId: opts.clientId ?? clientId }

  const bank = slotsFor(clientId)
  const used = usedReplies.slice(-24)
  const asksUsed = (normalized.usedAsks ?? []).slice(-16)
  // Цифры сессии + текущий ход менеджера
  normalized.mentionedFigures = mergeMentionedFigures(
    normalized.mentionedFigures,
    extractMentionedFigures(normalized.userText ?? ''),
  )

  const finish = (
    text: string,
    extra: Omit<ComposedBeat, 'text'>,
  ): ComposedBeat => {
    let out = stripMetaLead(text)
    out = stripBannedDrama(out)
    const ut = normalized.userText ?? ''
    if (
      isChoiceOrOptionQuestion(ut) ||
      isDirectWhQuestion(ut) ||
      isFocusedDiagnosticAsk(ut)
    ) {
      out = stripSkepticalFillers(out)
    }
    // Глобально вычищаем banned drama даже без вопроса
    if (SKEPTICAL_FILLER_RE.test(out) && isDirectWhQuestion(ut)) {
      out = stripSkepticalFillers(out)
    }
    return {
      text: voiceOut(out, clientId, normalized.alreadyGreeted),
      introAcknowledged: extra.introAcknowledged,
      ...extra,
    }
  }

  if (beat.id === 'pace_interrupt') {
    return finish(paceInterruptReply(used), {
      askUsed: null,
      hadAsk: false,
      listeningAckUsed: null,
    })
  }

  if (beat.id === 'nonsense') {
    const text = pick(poolFor(clientId, NONSENSE), used)
    return finish(text, {
      askUsed: null,
      hadAsk: /\?/.test(text),
      listeningAckUsed: null,
    })
  }
  if (beat.id === 'aggression') {
    const text = pick(poolFor(clientId, AGGRESSION), used)
    return finish(text, {
      askUsed: null,
      hadAsk: false,
      listeningAckUsed: null,
    })
  }

  // Turn-1 frame: Ack по имени (если есть) + подтвердить минуты + уточнить критерий
  if (beat.id === 'intro_frame') {
    const ut = normalized.userText ?? ''
    const parts: string[] = []
    let introAcked = false
    if (hasCallerIdentification(ut)) {
      const intro = buildIntroAcknowledgement(ut, used, normalized)
      if (intro.text) {
        // Короткий префикс без второго вопроса — рамка минут идёт следом
        const name = extractCallerFirstName(ut) ?? normalized.managerName
        const company =
          extractCallerCompany(ut) ?? normalized.managerCompany
        if (name) {
          parts.push(pick([`А, ${name}, приятно.`, `Понятно, ${name}.`], used))
        } else if (company) {
          parts.push(pick([`${company}? Ок.`, `Ок, ${company}.`], used))
        } else {
          parts.push(pick(['Ок, представились.', 'Понятно.'], used))
        }
        introAcked = true
      }
    }
    const ack = timeFrameAck(clientId, used)
    const ask = frameAsk(clientId, asksUsed)
    parts.push(ack, ask)
    return finish(joinParts(parts), {
      askUsed: ask,
      hadAsk: true,
      listeningAckUsed: introAcked ? parts[0]! : null,
      introAcknowledged: introAcked,
    })
  }

  // Без представления — не раскрываем боли, требуем идентификацию
  if (beat.id === 'contact_gate') {
    // Повторный игнор после «а вы кто?» — жёсткая insistence
    if (normalized.postGateReserved) {
      const text = fillGender(
        'Коллега, я всё ещё не {услышал}, с кем говорю. Представьтесь, пожалуйста, иначе диалога не получится.',
        voiceGenderForClient(clientId),
      )
      return finish(text, {
        askUsed: text,
        hadAsk: true,
        listeningAckUsed: null,
      })
    }
    const pool =
      clientId === 'artem'
        ? [
            'Подождите, а мы знакомы? Вы кто и из какой компании?',
            'Извините, не понял, с кем говорю. Вы откуда звоните?',
            'Давайте для начала познакомимся. Вы какую компанию представляете?',
            'Подождите. Мы с вами не знакомы. Вы из какой компании и по какому вопросу?',
          ]
        : [
            'Подождите, а мы знакомы? Вы кто?',
            'Извините, не поняла, с кем говорю. Вы откуда звоните?',
            'Давайте для начала познакомимся. Вы какую компанию представляете?',
            'Подождите, а вы кто и по какому вопросу звоните?',
            'Мы с вами не знакомы. Вы из какой компании?',
          ]
    const text = pick(pool, used)
    return finish(text, {
      askUsed: text,
      hadAsk: true,
      listeningAckUsed: null,
    })
  }

  // Реакция на презентацию — цена / Zoom-objection / next step (без боли)
  if (beat.id === 'post_pitch' || beat.policyId === 'beat:pitch_react') {
    const text =
      beat.topic === 'price' ||
      (normalized.userText &&
        /(zoom|зуум|демо|завтра|слот|\d{1,2}\s*[:.]\s*\d{2})/i.test(
          normalized.userText,
        ))
        ? postResolvedSlotLine(clientId, used)
        : postPitchReactLine(clientId, used, normalized.usedObjections)
    return finish(text, {
      askUsed: /\?/.test(text) ? text : null,
      hadAsk: /\?/.test(text),
      listeningAckUsed: null,
    })
  }

  // CHOICE / OPTION и post-gate discovery
  const discoveryish =
    beat.id === 'discovery_pain' ||
    beat.policyId === 'beat:discovery_answer' ||
    beat.policyId === 'beat:intro_substance' ||
    beat.id === 'pitch'

  const painKeys = normalized.usedPainFacts
  const factTopic = resolveFactTopic(
    beat.topic,
    normalized.userText,
    normalized,
  )

  // CHOICE / OPTION — выбираем способ; при представлении в той же реплике — сначала Ack
  if (
    discoveryish &&
    isChoiceOrOptionQuestion(normalized.userText ?? '')
  ) {
    const ut = normalized.userText ?? ''
    const fact = choiceAlignedFact(ut, clientId, used, painKeys)
    if (hasCallerIdentification(ut) || (normalized.hasIntroduced && !normalized.introAcknowledged)) {
      const intro = buildIntroAcknowledgement(ut, used, normalized)
      return finish(joinParts([intro.text, fact]), {
        askUsed: null,
        hadAsk: false,
        listeningAckUsed: intro.text || null,
        introAcknowledged: Boolean(intro.text),
      })
    }
    return finish(fact, {
      askUsed: null,
      hadAsk: false,
      listeningAckUsed: null,
    })
  }

  // После gatekeeper — сдержанный ответ; при представлении сначала персональный Ack
  if (normalized.postGateReserved && discoveryish) {
    const ut = normalized.userText ?? ''
    const introThisTurn =
      hasCallerIdentification(ut) ||
      (Boolean(normalized.hasIntroduced) && !normalized.introAcknowledged)
    if (introThisTurn) {
      const intro = buildIntroAcknowledgement(ut, used, normalized)
      // Только представление — не прыгаем в discovery-статы
      const hasDiag =
        isDirectWhQuestion(ut) ||
        isFocusedDiagnosticAsk(ut) ||
        isChoiceOrOptionQuestion(ut)
      if (!hasDiag || intro.hasAsk) {
        return finish(intro.text, {
          askUsed: intro.hasAsk ? intro.text : null,
          hadAsk: intro.hasAsk,
          listeningAckUsed: intro.text,
          introAcknowledged: Boolean(intro.text),
        })
      }
      // Представились + диагностический вопрос → Ack по имени, потом мягкий факт
      const fact = isChoiceOrOptionQuestion(ut)
        ? choiceAlignedFact(ut, clientId, used, painKeys)
        : reservedFact(factTopic, clientId, used, painKeys)
      return finish(joinParts([intro.text, fact]), {
        askUsed: null,
        hadAsk: false,
        listeningAckUsed: intro.text,
        introAcknowledged: Boolean(intro.text),
      })
    }
    // WH / focused diagnostic без intro в этой реплике: сразу факт
    if (isDirectWhQuestion(ut) || isFocusedDiagnosticAsk(ut)) {
      const fact = reservedFact(factTopic, clientId, used, painKeys)
      return finish(fact, {
        askUsed: null,
        hadAsk: false,
        listeningAckUsed: null,
      })
    }
    const ack = reservedWarmAck(ut, used, normalized)
    const fact = reservedFact(factTopic, clientId, used, painKeys)
    const ask = reservedAsk(asksUsed)
    return finish(joinParts([ack, fact, ask]), {
      askUsed: ask,
      hadAsk: true,
      listeningAckUsed: null,
    })
  }

  // Smooth stage guard: пока не узнал представление — только Ack, без deep stats
  if (
    discoveryish &&
    Boolean(normalized.hasIntroduced) &&
    !normalized.introAcknowledged &&
    !normalized.postGateReserved
  ) {
    const ut = normalized.userText ?? ''
    const intro = buildIntroAcknowledgement(ut, used, normalized)
    if (intro.text) {
      const hasDiag =
        isDirectWhQuestion(ut) ||
        isFocusedDiagnosticAsk(ut) ||
        isChoiceOrOptionQuestion(ut)
      if (!hasDiag || intro.hasAsk) {
        return finish(intro.text, {
          askUsed: intro.hasAsk ? intro.text : null,
          hadAsk: intro.hasAsk,
          listeningAckUsed: intro.text,
          introAcknowledged: true,
        })
      }
      const fact = isChoiceOrOptionQuestion(ut)
        ? choiceAlignedFact(ut, clientId, used, painKeys)
        : reservedFact(factTopic, clientId, used, painKeys)
      return finish(joinParts([intro.text, fact]), {
        askUsed: null,
        hadAsk: false,
        listeningAckUsed: intro.text,
        introAcknowledged: true,
      })
    }
  }

  // Discovery в той же реплике, что и первое представление (без postGate)
  if (
    discoveryish &&
    hasCallerIdentification(normalized.userText ?? '') &&
    !normalized.postGateReserved
  ) {
    const ut = normalized.userText ?? ''
    const intro = buildIntroAcknowledgement(ut, used, normalized)
    const hasDiag =
      isDirectWhQuestion(ut) ||
      isFocusedDiagnosticAsk(ut) ||
      isChoiceOrOptionQuestion(ut)
    if (!hasDiag || intro.hasAsk) {
      return finish(intro.text, {
        askUsed: intro.hasAsk ? intro.text : null,
        hadAsk: intro.hasAsk,
        listeningAckUsed: intro.text,
        introAcknowledged: Boolean(intro.text),
      })
    }
    const fact = isChoiceOrOptionQuestion(ut)
      ? choiceAlignedFact(ut, clientId, used, painKeys)
      : reservedFact(factTopic, clientId, used, painKeys)
    return finish(joinParts([intro.text, fact]), {
      askUsed: null,
      hadAsk: false,
      listeningAckUsed: intro.text,
      introAcknowledged: Boolean(intro.text),
    })
  }

  if (beat.template === 'statement') {
    if (beat.id === 'closing_need_slot') {
      return finish(
        'Хорошо, а когда именно созвонимся? Назовите день и время.',
        {
          askUsed: null,
          hadAsk: true,
          listeningAckUsed: null,
        },
      )
    }
    if (beat.id === 'closing_confirm') {
      const time = extractSlotTime(normalized.userText ?? '')
      if (time) {
        const text = fillGender(
          `Договорились, ${time} {записала}. Жду ссылку на Zoom в WhatsApp. До связи!`,
          voiceGenderForClient(clientId),
        )
        return finish(text, {
          askUsed: null,
          hadAsk: false,
          listeningAckUsed: null,
        })
      }
      if (hasExplicitDateTimeSlot(normalized.userText ?? '')) {
        return finish(
          'Договорились. Жду ссылку на Zoom в WhatsApp. До связи!',
          {
            askUsed: null,
            hadAsk: false,
            listeningAckUsed: null,
          },
        )
      }
      return finish(
        'Хорошо, а когда именно созвонимся? Назовите день и время.',
        {
          askUsed: null,
          hadAsk: true,
          listeningAckUsed: null,
        },
      )
    }
    // closing_ok: AGREED только с днём+временем — без «когда удобно»
    if (beat.id === 'closing_ok') {
      const time = extractSlotTime(normalized.userText ?? '')
      if (time) {
        const text = fillGender(
          `Договорились, ${time} {записала}. Жду ссылку на Zoom в WhatsApp. До связи!`,
          voiceGenderForClient(clientId),
        )
        return finish(text, {
          askUsed: null,
          hadAsk: false,
          listeningAckUsed: null,
        })
      }
      if (hasExplicitDateTimeSlot(normalized.userText ?? '')) {
        return finish(
          'Договорились. Жду ссылку на Zoom в WhatsApp. До связи!',
          {
            askUsed: null,
            hadAsk: false,
            listeningAckUsed: null,
          },
        )
      }
      return finish(
        'Хорошо, а когда именно созвонимся? Назовите день и время.',
        {
          askUsed: null,
          hadAsk: true,
          listeningAckUsed: null,
        },
      )
    }
    const text = statementForBeat(
      beat,
      bank,
      used,
      (normalized.turn ?? 99) < 2,
      normalized,
    )
    return finish(text, {
      askUsed: null,
      hadAsk: false,
      listeningAckUsed: null,
    })
  }

  const earlyTurn = (normalized.turn ?? 99) < 2
  const { ack, listeningAckUsed } = ackForBeat(beat, bank, used, normalized)

  switch (beat.template) {
    case 'ack_ask': {
      const ask = askForBeat(beat, bank, asksUsed, normalized)
      return finish(joinParts([ack, ask]), {
        askUsed: ask,
        hadAsk: true,
        listeningAckUsed,
      })
    }
    case 'ack_fact': {
      const fact = factForBeat(
        beat,
        bank,
        used,
        earlyTurn,
        painKeys,
        normalized,
      )
      return finish(joinParts([ack, fact]), {
        askUsed: null,
        hadAsk: false,
        listeningAckUsed,
      })
    }
    case 'ack_fact_ask': {
      const fact = factForBeat(
        beat,
        bank,
        used,
        earlyTurn,
        painKeys,
        normalized,
      )
      const ask = askForBeat(beat, bank, asksUsed, normalized)
      return finish(joinParts([ack, fact, ask]), {
        askUsed: ask,
        hadAsk: true,
        listeningAckUsed,
      })
    }
    case 'ack_statement': {
      const st = statementForBeat(beat, bank, used, earlyTurn, normalized)
      return finish(joinParts([ack, st]), {
        askUsed: null,
        hadAsk: false,
        listeningAckUsed,
      })
    }
    case 'ack_fact_statement': {
      const fact = factForBeat(
        beat,
        bank,
        used,
        earlyTurn,
        painKeys,
        normalized,
      )
      const st = statementForBeat(beat, bank, used, earlyTurn, normalized)
      return finish(joinParts([ack, fact, st]), {
        askUsed: null,
        hadAsk: false,
        listeningAckUsed,
      })
    }
    case 'single_pool':
      return finish(ack, {
        askUsed: null,
        hadAsk: false,
        listeningAckUsed,
      })
    default:
      return finish(ack, {
        askUsed: null,
        hadAsk: false,
        listeningAckUsed,
      })
  }
}
