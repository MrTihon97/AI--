/**
 * Beat planner: что клиент ОБЯЗАН сделать в этом ходе.
 *
 * Банк = слоты Ack / Fact / Ask / Statement.
 * Не каждый ход обязан заканчиваться вопросом.
 */
import type { DialogueContext } from './machine'
import type { NluIntentId } from './training'
import {
  hasExplicitDateTimeSlot,
  managerStatedPrice,
  offersDemoSlot,
  isSlotTimeInput,
} from './entities'
import { detectTopic, type SlotTopic } from './personaSlots'
import {
  canAcceptDemo,
  isPushbackPersona,
  mustForceClosingPushback,
  objectionBeatKind,
  traitsForClient,
} from './personaTraits'
import {
  isFullReplacementPitch,
  isIntegrationPitch,
  mentionsLegacyCrm,
} from './intents'

/** Менеджер спрашивает про текущую МИС / 1С на discovery. */
export function asksAboutLegacyCrmStack(userText: string): boolean {
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  if (mentionsLegacyCrm(userText)) return true
  if (
    /(?:какая|какой|что\s+за|на\s+ч[её]м|чем\s+вед).{0,48}(?:мис|crm|1\s*[cс]|1с|учётн|программ|софт|систем|журнал)/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /(?:есть\s+ли|используете|стоите\s+на|сидите\s+на|какая\s+у\s+вас).{0,32}(?:1\s*[cс]|1с|мис|crm|инфодент|программ)/i.test(
      t,
    )
  ) {
    return true
  }
  return false
}

function wantsLegacyCrmDiscoveryDisclosure(
  ctx: DialogueContext,
  userText: string,
  intentId: NluIntentId,
): boolean {
  if (isFullReplacementPitch(userText) || isIntegrationPitch(userText)) {
    return false
  }
  const stageOk =
    ctx.stage === 'discovery' ||
    (ctx.stage === 'intro' &&
      (ctx.slots.hasIntroduced ||
        ctx.slots.contactEstablished ||
        ctx.slots.introAcknowledged))
  if (!stageOk) return false
  if (ctx.stage === 'objection' || ctx.stage === 'presentation' || ctx.stage === 'closing') {
    return false
  }
  return (
    intentId === 'ask_competitors' ||
    asksAboutLegacyCrmStack(userText) ||
    mentionsLegacyCrm(userText)
  )
}

function legacyCrmDiscoveryBeat(): Beat {
  return {
    id: 'legacy_crm_discovery',
    policyId: 'beat:legacy:crm_discovery',
    template: 'ack_fact_ask',
    topic: 'journal',
    skipHook: true,
    skipTone: true,
    soft: true,
  }
}

export type BeatTemplate =
  | 'ack_ask'
  | 'ack_fact'
  | 'ack_fact_ask'
  | 'ack_statement'
  | 'ack_fact_statement'
  | 'statement'
  | 'single_pool'

export type BeatId =
  | 'intro_open'
  | 'intro_hello'
  | 'intro_frame'
  | 'contact_gate'
  | 'line_ping'
  | 'discovery_pain'
  | 'price_early'
  | 'price_stated'
  | 'price_discuss'
  | 'pitch'
  | 'post_pitch'
  | 'closing_ok'
  | 'closing_confirm'
  | 'closing_need_slot'
  | 'closing_early'
  | 'objection'
  | 'busy'
  | 'clarify'
  | 'nonsense'
  | 'aggression'
  | 'pace_interrupt'
  | 'persona_pushback'
  | 'objection_busy'
  | 'objection_skepticism'
  | 'legacy_crm'
  | 'legacy_crm_discovery'
  | 'legacy_replacement_error'
  | 'legacy_integration_ok'

export type Beat = {
  id: BeatId
  policyId: string
  template: BeatTemplate
  topic: SlotTopic
  skipHook: boolean
  skipTone: boolean
  soft: boolean
  markFollowUp?: boolean
}

function isShortHello(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/ё/g, 'е')
  return /^(привет|приветик|здравствуй(те)?|добрый(\s+(день|вечер|утро))?|алло|ало|хай|хеллоу|салют|да|слушаю|угу|ага)[.!?…]*$/i.test(
    t,
  )
}

/**
 * Содержательный интро/питч: менеджер уже назвал тему —
 * нельзя отвечать «по какому поводу звоните?».
 */
export function hasSubstantialPitch(text: string): boolean {
  const t = text.trim()
  if (t.length < 55) return false
  if (isShortHello(t)) return false
  return /(звон|автоматиз|запис|отмен|пациент|crm|потер|неявк|минут|компани|меня\s+зовут|по\s+поводу|полезн|вопрос)/i.test(
    t,
  )
}

/** «Ок / в WhatsApp / давай / 13:00» после демо — подтверждение, не новый допрос. */
function isClosingConfirm(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/ё/g, 'е')
  if (isSlotTimeInput(text)) return true
  return /^(ок|окей|хорошо|давай|ладно|договорились|принято|супер|в\s*whatsapp|в\s*ватсап|в\s*вотсап|пиши(те)?|присылай(те)?|жду|да)[.!?…]*$/i.test(
    t,
  ) || /^(напиши|скинь|пришли).{0,40}(whatsapp|ватсап|вотсап|ссылк)/i.test(t)
}

/**
 * Менеджер просит рамку времени («удобно 2 минуты?»).
 */
export function asksTimePermission(userText: string): boolean {
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  return /удобно\s+(\d+\s+)?(минут|секунд)|есть\s+(ли\s+)?(\d+\s+)?минут|пару\s+минут|две\s+минут|\b2\s+минут|несколько\s+минут|минут\s+\d/i.test(
    t,
  )
}

/**
 * Высокоуровневый заход без конкретной диагностики
 * («сравниваю решения для сетей») — нельзя выдумывать боли/партнёра.
 */
export function isHighLevelCompareFrame(userText: string): boolean {
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  const high =
    /(сравнива\w*|выбира\w*\s+решени|смотрю\s+(варианты|решени|crm|систем)|для\s+сет(и|ей)|по\s+сети|сетев\w*\s+(клиник|стомат)|решени\w*\s+для\s+сет)/i.test(
      t,
    )
  const concrete =
    isFocusedDiagnosticAsk(userText) ||
    /(сколько\s+заяв\w*|неявк\w*.{0,12}\d|потер\w*.{0,20}\d|whatsapp|ватсап|как\s+фиксир|кто\s+вед)/i.test(
      t,
    )
  return high && !concrete
}

function isEarlyIntroTurn(ctx: DialogueContext): boolean {
  return (
    ctx.turn < 2 &&
    (ctx.stage === 'intro' || ctx.stage === 'discovery' || ctx.turn === 0)
  )
}

function introFrameBeat(): Beat {
  return {
    id: 'intro_frame',
    policyId: 'beat:intro_frame',
    template: 'ack_ask',
    topic: 'generic',
    skipHook: true,
    skipTone: true,
    soft: true,
  }
}

function postPitchReactBeat(): Beat {
  return {
    id: 'post_pitch',
    policyId: 'beat:pitch_react',
    template: 'statement',
    topic: 'generic',
    skipHook: true,
    skipTone: true,
    soft: false,
  }
}

/** Soft close без дня+времени — требуем конкретный слот. */
function closingNeedSlotBeat(): Beat {
  return {
    id: 'closing_need_slot',
    policyId: 'beat:closing_need_slot',
    template: 'statement',
    topic: 'demo',
    skipHook: true,
    skipTone: true,
    soft: true,
  }
}

/**
 * После «в чём суть?» / pushback или уже был питч —
 * презентация менеджера двигает сделку, а не возвращает к боли.
 * Не путать с повторным discovery-вопросом после первой боли.
 */
export function shouldReactToPitch(ctx: DialogueContext): boolean {
  return (
    Boolean(ctx.slots.personaPushbackShown) || Boolean(ctx.slots.pitched)
  )
}

function shouldAsk(
  ctx: DialogueContext,
  mode: 'force' | 'prefer' | 'avoid' | 'alternate',
  opts: { userAskedDiagnostic?: boolean } = {},
): boolean {
  if (mode === 'avoid') return false
  // Менеджер спросил про процесс — сначала отвечаем фактом, без встречного вопроса
  if (opts.userAskedDiagnostic) return false
  // Ходы 1–2: не усложняем встречными «что даёте / какой ROI»
  if (ctx.turn < 2 && mode !== 'force') return false
  if (mode === 'force') return true
  if (ctx.lastReplyHadAsk) return false
  if (mode === 'alternate') return !ctx.lastReplyHadAsk
  return !ctx.lastReplyHadAsk
}

function withAskTemplate(
  withAsk: boolean,
  asked: 'ack_fact_ask' | 'ack_ask',
  without: 'ack_fact' | 'ack_fact_statement' | 'ack_statement' | 'statement',
): BeatTemplate {
  return withAsk ? asked : without
}

/** Сомнение / «мне некогда» — хотя бы раз до лёгкого согласия на демо. */
function personaPushbackBeat(
  topic: SlotTopic,
  ctx: DialogueContext,
  opts: { hardClosing?: boolean } = {},
): Beat {
  const traits = traitsForClient(ctx.clientId)
  const kind = objectionBeatKind(
    traits,
    ctx.slots.closingAttempts ?? 0,
  )
  // PROPOSE_TIME без hasHandledObjection → objection_busy / objection_skepticism
  if (opts.hardClosing) {
    const id = kind === 'busy' ? 'objection_busy' : 'objection_skepticism'
    return {
      id,
      policyId: `beat:${id}`,
      template: 'statement',
      topic: 'demo',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }
  const ask = shouldAsk(ctx, 'prefer')
  return {
    id: 'persona_pushback',
    policyId: 'beat:persona_pushback',
    template: ask ? 'ack_ask' : 'ack_statement',
    topic,
    skipHook: true,
    skipTone: true,
    soft: true,
  }
}

function needsPersonaPushback(ctx: DialogueContext): boolean {
  const traits = traitsForClient(ctx.clientId)
  if (!isPushbackPersona(traits)) return false
  if (ctx.slots.personaPushbackShown) return false
  return true
}

/**
 * Сфокусированный диагностический вопрос менеджера о процессе —
 * отвечаем по теме (кто ведёт запись / как фиксируете), не перебиваем
 * встречным «что даёте…».
 */
export function isFocusedDiagnosticAsk(userText: string): boolean {
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  const hasAskMark =
    /\?/.test(t) ||
    /(подскажите|скажите|уточните|расскажите)/i.test(t)
  if (!hasAskMark) return false
  return /(как\s+(сейчас\s+)?|подскажите|скажите|уточните|расскажите|а\s+как|каким\s+образом|кто\s+(вед[её]т|ведет|фиксир|отвечает|занимается|дожимает)|как\s+(фиксир|вед[её]т|ведет|отслежива|счита|напоминан|работаете)|отслеживаете|фиксируете|вед[её]те\s+запис|ведете\s+запис|где\s+(теря|висит|ломается)|сколько\s+(заяв\w*|неяв\w*|потер\w*))/i.test(
    t,
  )
}

/**
 * CHOICE_QUESTION / OPTION_LIST: «кто ведёт — журнал / Excel / WhatsApp?»
 * Нужно выбрать вариант, а не «Ну, допустим».
 */
export function isChoiceOrOptionQuestion(userText: string): boolean {
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  const hits = t.match(
    /журнал|excel|эксель|whatsapp|ватсап|вотсап|тетрад|1с|мессенджер/gi,
  )
  if (hits && hits.length >= 2 && /(\/|\bили\b|—|–)/.test(t)) return true
  if (
    /кто\s+вед/.test(t) &&
    /(журнал|excel|whatsapp|ватсап|мессенджер)/i.test(t)
  ) {
    return true
  }
  return false
}

/** Прямой WH-вопрос — без скептических филлеров «допустим». */
export function isDirectWhQuestion(userText: string): boolean {
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  const hasAsk =
    /\?/.test(userText) ||
    /(подскажите|скажите|уточните|расскажите)/i.test(t)
  if (!hasAsk) return false
  return /\b(кто|как|сколько|какой|какие|где|почему|чем|что)\b/i.test(t)
}

/**
 * Представление / введение в контакт (hasIntroduced).
 * Keywords: меня зовут, я из, компания, ДентаCRM, автоматизация,
 * насчёт записи, по поводу, «Это Тихон…».
 * НЕ считаем представление: голый «удобно N минут?» / сравнить без ID.
 */
export function hasCallerIdentification(userText: string): boolean {
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  if (
    /(меня\s+зовут|я\s+из\b|из\s+компани|компани[яи]|дента\s*crm|дентаcrm|автоматизац|насч[её]т\s+запис|по\s+поводу)/i.test(
      t,
    )
  ) {
    return true
  }
  // «Это Тихон / Это Анна, …»
  if (/(?:^|[^a-zа-я0-9])это\s+[a-zа-яё][a-zа-яё\d-]{1,24}\b/i.test(t)) {
    return true
  }
  // Приветствие + явная компания / имя
  if (
    /(здравств|добр(ый|ое|ого)|привет)/i.test(t) &&
    /(компани|дента|зовут|это\s+[a-zа-яё])/i.test(t)
  ) {
    return true
  }
  return false
}

/**
 * Имя менеджера из представления: «меня зовут X», «это X», «я X из …».
 */
export function extractCallerFirstName(userText: string): string | null {
  const raw = userText.trim()
  if (!raw) return null
  // \b плохо стыкуется с кириллицей в JS — якорим пробелом/пунктуацией/концом
  const patterns = [
    /меня\s+зовут\s+([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё-]{1,24})(?=[\s,!.?…]|$)/i,
    /(?:^|[^A-Za-zА-Яа-яЁё0-9])это\s+([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё-]{1,24})(?=[\s,!.?…]|$)/i,
    /(?:^|[^A-Za-zА-Яа-яЁё0-9])я\s+([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё-]{1,24})\s+из\b/i,
    /(?:^|[^A-Za-zА-Яа-яЁё0-9])я\s+([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё-]{1,24})\s*,/i,
  ]
  const stop = new Set(
    [
      'из',
      'хочу',
      'сейчас',
      'просто',
      'вам',
      'здесь',
      'уже',
      'ещё',
      'еще',
      'там',
      'тут',
      'так',
      'это',
      'бы',
      'же',
      'ли',
      'не',
      'мы',
      'вы',
      'он',
      'она',
      'компания',
      'компани',
    ].map((w) => w.toLowerCase()),
  )
  for (const re of patterns) {
    const m = re.exec(raw)
    if (!m?.[1]) continue
    const name = m[1]
    if (stop.has(name.toLowerCase())) continue
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return null
}

/**
 * Компания из представления: «компания X», «из X», ДентаCRM.
 */
export function extractCallerCompany(userText: string): string | null {
  const raw = userText.trim()
  if (!raw) return null
  if (/дента\s*crm|дентаcrm/i.test(raw)) return 'ДентаCRM'
  const m =
    /компани[яи]\s+([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9«»"'\-]{1,40})/i.exec(
      raw,
    ) ||
    /из\s+(?:компани[ии]\s+)?([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9«»"'\-]{1,40})/i.exec(
      raw,
    )
  if (!m?.[1]) return null
  const company = m[1].replace(/[«»"']/g, '').trim()
  if (/^(какой|какой-то|нашей|вашей)$/i.test(company)) return null
  return company.charAt(0).toUpperCase() + company.slice(1)
}

/** @deprecated alias — то же, что hasCallerIdentification */
export const hasIntroducedInText = hasCallerIdentification

/** Глубокий диагностический / loss-зонд без представления. */
export function isDeepDiagnosticProbe(userText: string): boolean {
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  if (isFocusedDiagnosticAsk(userText)) return true
  return /(сколько\s+(заяв\w*|неяв\w*|потер\w*)|теряете|теряется|какие\s+потери|как\s+у\s+вас\s+(сейчас\s+)?(с\s+)?(заяв|потер|неявк)|успевает\s+ли|есть\s+ли\s+у\s+вас)/i.test(
    t,
  )
}

/** Вопрос/зонд про процесс клиники без представления. */
export function isBusinessProbeWithoutIntro(userText: string): boolean {
  if (hasCallerIdentification(userText)) return false
  if (isDeepDiagnosticProbe(userText)) return true
  if (isFocusedDiagnosticAsk(userText)) return true
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  return /(заявк|потер|неявк|запис|whatsapp|ватсап|процесс|админ|журнал|excel|сколько|кресл|как\s+(у\s+вас|сейчас|вед)|кто\s+вед|конверси|филиал)/i.test(
    t,
  )
}

/**
 * Gate: без представления — абсолютный блок (не только «deep»-диагностика).
 * «Сколько у вас кресел?» без имени/компании → contact_gate, не discovery/price.
 * Escape по turn/greeted УБРАН: иначе игнор gate → leak clinic data.
 */
export function needsContactGate(
  ctx: DialogueContext,
  userText: string,
): boolean {
  // Уже узнал представление в Ack — воронка открыта
  if (ctx.slots.introAcknowledged) return false

  const introduced =
    Boolean(ctx.slots.contactEstablished) ||
    Boolean(ctx.slots.hasIntroduced)
  if (introduced) return false
  if (hasCallerIdentification(userText)) return false

  // Поздние этапы / слот после демо — не откатываем в gate
  // (сессия уже прошла контакт или восстановлена из snapshot)
  if (
    ctx.stage === 'presentation' ||
    ctx.stage === 'objection' ||
    ctx.stage === 'closing' ||
    ctx.slots.demoOffered ||
    ctx.slots.pitched ||
    (ctx.slots.painFound && ctx.stage !== 'intro')
  ) {
    return false
  }

  // Короткий hello / «алло» — не gate (идёт в intro_hello / line_ping)
  if (isShortHello(userText)) return false

  // Чистая рамка минут / high-level compare без диагностики — intro_frame
  if (
    asksTimePermission(userText) &&
    !isDeepDiagnosticProbe(userText) &&
    !isFocusedDiagnosticAsk(userText) &&
    !isBusinessProbeWithoutIntro(userText)
  ) {
    return false
  }
  if (
    isHighLevelCompareFrame(userText) &&
    !isDeepDiagnosticProbe(userText) &&
    !isFocusedDiagnosticAsk(userText)
  ) {
    return false
  }

  // Absolute: любой другой ввод без имени/компании на intro/раннем discovery
  return true
}

function contactGateBeat(): Beat {
  return {
    id: 'contact_gate',
    policyId: 'beat:contact_gate',
    template: 'statement',
    topic: 'generic',
    skipHook: true,
    skipTone: true,
    soft: true,
  }
}

/**
 * Выбрать beat для хода. null = пусть policy уйдёт в legacy-fallback.
 */
export function planBeat(input: {
  intentId: NluIntentId
  ctx: DialogueContext
  userText: string
  isNonsense: boolean
  isDeveloped: boolean
  isOpening?: boolean
}): Beat | null {
  const { intentId, ctx, userText, isNonsense, isDeveloped, isOpening } = input
  // Без представления — keywords (цена/CRM/zoom) не выбирают топик
  const gated =
    needsContactGate(ctx, userText) ||
    (!ctx.slots.hasIntroduced &&
      !ctx.slots.contactEstablished &&
      !ctx.slots.introAcknowledged &&
      !hasCallerIdentification(userText) &&
      !isShortHello(userText))
  const topic = gated
    ? 'generic'
    : detectTopic(userText, ctx.mentionedEntities)
  const early = ctx.stage === 'intro' || ctx.stage === 'discovery'
  const shortHello = isShortHello(userText)
  const traits = traitsForClient(ctx.clientId)
  const pushbackClient = isPushbackPersona(traits)

  if (isOpening) {
    return {
      id: 'intro_open',
      policyId: 'beat:intro_open',
      template: 'ack_ask',
      topic: 'generic',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  if (intentId === 'aggression') {
    return {
      id: 'aggression',
      policyId: 'beat:aggression',
      template: 'single_pool',
      topic: 'generic',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  // Absolute intro gate ДО nonsense: «Сколько кресел?» не должно
  // уходить в nonsense/price из‑за редкого слова вне словаря.
  if (needsContactGate(ctx, userText)) {
    return contactGateBeat()
  }

  if (isNonsense || intentId === 'nonsense') {
    return {
      id: 'nonsense',
      policyId: 'beat:nonsense',
      template: 'single_pool',
      topic: 'generic',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  // Turn 1: «удобно N минут?» / «сравниваю решения…» — без выдуманных болей
  if (
    isEarlyIntroTurn(ctx) &&
    !isFocusedDiagnosticAsk(userText) &&
    (asksTimePermission(userText) || isHighLevelCompareFrame(userText))
  ) {
    return introFrameBeat()
  }

  // Подтверждение слота/канала после закрытия (в т.ч. «завтра в 13:00»)
  // Soft WhatsApp / «ок» без дня+времени → требуем слот, не AGREED
  // Hard gate: первая попытка закрытия у скептика → pushback, не confirm
  if (
    (isClosingConfirm(userText) ||
      isSlotTimeInput(userText) ||
      intentId === 'clarify') &&
    (ctx.slots.demoOffered || ctx.stage === 'closing')
  ) {
    if (
      mustForceClosingPushback({
        clientId: ctx.clientId,
        slots: ctx.slots,
      })
    ) {
      return personaPushbackBeat('demo', ctx, { hardClosing: true })
    }
    if (!hasExplicitDateTimeSlot(userText)) {
      return closingNeedSlotBeat()
    }
    return {
      id: 'closing_confirm',
      policyId: 'beat:closing_confirm',
      template: 'statement',
      topic: 'demo',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  // Только КОРОТкое приветствие. Длинный интро с темой — не greeting-beat.
  const greetingOnly =
    shortHello ||
    ((intentId === 'greeting' || (intentId === 'smalltalk' && early)) &&
      !isDeveloped &&
      !hasSubstantialPitch(userText))

  if (greetingOnly) {
    // После открытия чата / уже поздоровались — не дублируем «Добрый день»
    if (ctx.slots.greeted || ctx.turn >= 1 || ctx.stage !== 'intro') {
      return {
        id: 'line_ping',
        policyId: 'beat:line_ping',
        template: shouldAsk(ctx, 'alternate') ? 'ack_ask' : 'ack_statement',
        topic: 'generic',
        skipHook: true,
        skipTone: true,
        soft: true,
      }
    }
    return {
      id: 'intro_hello',
      policyId: 'beat:intro_hello',
      template: 'ack_ask',
      topic: 'generic',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  // Длинный интро «добрый день + тема» — слушаем суть, не переспрашиваем «о чём звонок»
  if (
    (intentId === 'greeting' || intentId === 'smalltalk' || intentId === 'busy') &&
    (isDeveloped || hasSubstantialPitch(userText))
  ) {
    const diagnostic = isFocusedDiagnosticAsk(userText)
    const timeAsk = asksTimePermission(userText)
    const highLevel = isHighLevelCompareFrame(userText)

    // Turn 1: подтвердить минуты / не выдумывать боли и партнёра
    if (
      isEarlyIntroTurn(ctx) &&
      !diagnostic &&
      (timeAsk || highLevel)
    ) {
      return introFrameBeat()
    }

    const ask = shouldAsk(ctx, diagnostic ? 'avoid' : 'prefer', {
      userAskedDiagnostic: diagnostic,
    })
    const painTopic =
      topic === 'generic'
        ? /отмен|неявк|потер|запис/i.test(userText)
          ? 'no_shows'
          : highLevel
            ? 'generic'
            : 'losses'
        : topic
    return {
      id: 'pitch',
      policyId: diagnostic ? 'beat:discovery_answer' : 'beat:intro_substance',
      template: withAskTemplate(ask, 'ack_fact_ask', 'ack_fact_statement'),
      topic: painTopic,
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  // Демо / слот времени — приоритетнее цены (иначе «3000 + завтра в 11» уходит в price_stated)
  if (
    (intentId === 'closing' || offersDemoSlot(userText)) &&
    (ctx.slots.painFound ||
      ctx.slots.priceDiscussed ||
      ctx.slots.demoOffered ||
      ctx.stage === 'closing' ||
      ctx.stage === 'objection' ||
      ctx.stage === 'presentation' ||
      !early)
  ) {
    if (!ctx.slots.painFound && early && !ctx.slots.priceDiscussed) {
      return {
        id: 'closing_early',
        policyId: 'beat:closing_early',
        template: shouldAsk(ctx, 'prefer') ? 'ack_ask' : 'ack_statement',
        topic: 'demo',
        skipHook: true,
        skipTone: true,
        soft: true,
      }
    }
  // Hard gate: closing без отработанного возражения → objection
  // После hasHandledObjection + слот — ACCEPT, не «сначала суть»
    if (
      pushbackClient &&
      mustForceClosingPushback({
        clientId: ctx.clientId,
        slots: ctx.slots,
      })
    ) {
      return personaPushbackBeat(
        topic === 'generic' ? 'demo' : topic,
        ctx,
        { hardClosing: true },
      )
    }
    if (
      pushbackClient &&
      !canAcceptDemo({
        clientId: ctx.clientId,
        userText,
        slots: ctx.slots,
      })
    ) {
      // Возражение уже было — не крутим «суть», а цена / контр-слот
      if (
        ctx.slots.hasHandledObjection ||
        (ctx.usedObjections ?? []).includes('GIVE_ESSENCE')
      ) {
        return {
          id: 'post_pitch',
          policyId: 'beat:pitch_react',
          template: 'statement',
          topic: 'price',
          skipHook: true,
          skipTone: true,
          soft: false,
        }
      }
      return personaPushbackBeat(
        topic === 'generic' ? 'demo' : topic,
        ctx,
        { hardClosing: true },
      )
    }
    // Без дня+времени — не AGREED / не SESSION_COMPLETE
    if (!hasExplicitDateTimeSlot(userText)) {
      return closingNeedSlotBeat()
    }
    // Повторное предложение слота / цена+демо — одна финальная реплика (не ack+statement)
    return {
      id: 'closing_ok',
      policyId: 'beat:closing_ok',
      template: 'statement',
      topic: 'demo',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  if (managerStatedPrice(userText) && !offersDemoSlot(userText)) {
    const ask = shouldAsk(ctx, 'alternate')
    return {
      id: 'price_stated',
      policyId: 'beat:price_stated',
      template: withAskTemplate(ask, 'ack_fact_ask', 'ack_fact_statement'),
      topic: 'price',
      skipHook: true,
      skipTone: false,
      soft: true,
    }
  }

  // Discovery + вопрос про МИС/1С → явно назвать стек (не objection-push)
  if (wantsLegacyCrmDiscoveryDisclosure(ctx, userText, intentId)) {
    return legacyCrmDiscoveryBeat()
  }

  // Короткий value_pitch в intro/discovery = продолжение боли (не pitch_followup),
  // НО не после pushback / уже найденной боли — тогда реакция на решение.
  if (
    intentId === 'need_discovery' ||
    (early &&
      intentId === 'value_pitch' &&
      !isDeveloped &&
      !shouldReactToPitch(ctx))
  ) {
    const diagnostic = isFocusedDiagnosticAsk(userText)
    const timeAsk = asksTimePermission(userText)
    const highLevel = isHighLevelCompareFrame(userText)

    if (
      isEarlyIntroTurn(ctx) &&
      !diagnostic &&
      (timeAsk || highLevel)
    ) {
      return introFrameBeat()
    }

    // Скепсис/занятость: после первой боли — хотя бы одно сомнение / тайм-прессинг
    // (не перебиваем сфокусированный вопрос про WhatsApp/процесс)
    if (
      needsPersonaPushback(ctx) &&
      (ctx.slots.painFound || ctx.turn >= 2) &&
      !diagnostic
    ) {
      return personaPushbackBeat(topic === 'generic' ? 'losses' : topic, ctx)
    }
    // Диагностика менеджера / ранние ходы — факт-ответ без встречного вопроса
    const ask = shouldAsk(
      ctx,
      diagnostic ? 'avoid' : ctx.slots.painFound ? 'alternate' : 'force',
      { userAskedDiagnostic: diagnostic },
    )
    return {
      id: 'discovery_pain',
      policyId: diagnostic ? 'beat:discovery_answer' : 'beat:discovery_pain',
      template: withAskTemplate(ask, 'ack_fact_ask', 'ack_fact_statement'),
      topic:
        topic === 'generic'
          ? highLevel
            ? 'generic'
            : 'losses'
          : topic,
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  if (isDeveloped || intentId === 'value_pitch') {
    const diagnostic = isFocusedDiagnosticAsk(userText)
    // Ответ на «в чём суть?» / презентация после боли → цена / Zoom-objection / next step
    if (
      !diagnostic &&
      intentId === 'value_pitch' &&
      shouldReactToPitch(ctx)
    ) {
      return postPitchReactBeat()
    }
    if (
      needsPersonaPushback(ctx) &&
      (ctx.slots.painFound || ctx.slots.pitched) &&
      !diagnostic
    ) {
      return personaPushbackBeat(topic === 'generic' ? 'losses' : topic, ctx)
    }
    const follow =
      !ctx.slots.followUpAsked &&
      (isDeveloped || (intentId === 'value_pitch' && ctx.slots.painFound))
    const ask = shouldAsk(ctx, diagnostic ? 'avoid' : 'prefer', {
      userAskedDiagnostic: diagnostic,
    })
    return {
      id: 'pitch',
      policyId:
        diagnostic
          ? 'beat:discovery_answer'
          : follow && ask
            ? 'beat:pitch_followup'
            : 'beat:pitch',
      template: withAskTemplate(ask, 'ack_fact_ask', 'ack_fact_statement'),
      topic: topic === 'generic' ? 'losses' : topic,
      skipHook: false,
      skipTone: false,
      soft: false,
      markFollowUp: follow && ask,
    }
  }

  if (intentId === 'ask_price' && !ctx.slots.painFound) {
    return {
      id: 'price_early',
      policyId: 'beat:price_early',
      template: shouldAsk(ctx, 'force') ? 'ack_ask' : 'ack_statement',
      topic: 'price',
      skipHook: false,
      skipTone: false,
      soft: false,
    }
  }

  if (intentId === 'ask_price' || intentId === 'price_defense') {
    const ask = shouldAsk(ctx, 'alternate')
    return {
      id: 'price_discuss',
      policyId: 'beat:price_discuss',
      template: withAskTemplate(ask, 'ack_fact_ask', 'ack_fact_statement'),
      topic: 'price',
      skipHook: false,
      skipTone: false,
      soft: false,
    }
  }

  if (intentId === 'closing') {
    if (!ctx.slots.painFound && early && !ctx.slots.priceDiscussed) {
      return {
        id: 'closing_early',
        policyId: 'beat:closing_early',
        template: shouldAsk(ctx, 'prefer') ? 'ack_ask' : 'ack_statement',
        topic: 'demo',
        skipHook: true,
        skipTone: true,
        soft: true,
      }
    }
    if (
      pushbackClient &&
      !canAcceptDemo({
        clientId: ctx.clientId,
        userText,
        slots: ctx.slots,
      })
    ) {
      if (needsPersonaPushback(ctx)) {
        return personaPushbackBeat('demo', ctx)
      }
      if (
        ctx.slots.hasHandledObjection ||
        (ctx.usedObjections ?? []).includes('GIVE_ESSENCE')
      ) {
        return {
          id: 'post_pitch',
          policyId: 'beat:pitch_react',
          template: 'statement',
          topic: 'price',
          skipHook: true,
          skipTone: true,
          soft: false,
        }
      }
      return personaPushbackBeat('demo', ctx, { hardClosing: true })
    }
    if (!hasExplicitDateTimeSlot(userText)) {
      return closingNeedSlotBeat()
    }
    return {
      id: 'closing_ok',
      policyId: 'beat:closing_ok',
      template: 'statement',
      topic: 'demo',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  if (
    intentId === 'ask_competitors' ||
    intentId === 'ask_implementation' ||
    intentId === 'ask_security' ||
    intentId === 'handle_objection' ||
    intentId === 'doubt' ||
    intentId === 'authority' ||
    mentionsLegacyCrm(userText) ||
    isFullReplacementPitch(userText) ||
    isIntegrationPitch(userText)
  ) {
    // Ветка сторонней МИС: замена (ошибка) vs интеграция (успех) vs озвучка возражения
    if (
      isFullReplacementPitch(userText) ||
      (intentId === 'ask_competitors' && isFullReplacementPitch(userText))
    ) {
      return {
        id: 'legacy_replacement_error',
        policyId: 'beat:legacy:replacement_error',
        template: 'ack_fact_statement',
        topic: 'journal',
        skipHook: true,
        skipTone: false,
        soft: false,
      }
    }
    if (isIntegrationPitch(userText)) {
      return {
        id: 'legacy_integration_ok',
        policyId: 'beat:legacy:integration_ok',
        template: shouldAsk(ctx, 'prefer')
          ? 'ack_fact_ask'
          : 'ack_fact_statement',
        topic: 'journal',
        skipHook: false,
        skipTone: false,
        soft: false,
      }
    }
    if (
      intentId === 'ask_competitors' ||
      mentionsLegacyCrm(userText) ||
      ctx.slots.legacyCrmRaised
    ) {
      // Менеджер затронул конкурента/МИС без стратегии
      if (
        !ctx.slots.integrationPitchOk &&
        !isIntegrationPitch(userText) &&
        !isFullReplacementPitch(userText)
      ) {
        // На discovery уже отработали disclosure выше; здесь — objection-push
        if (
          ctx.stage === 'discovery' ||
          (ctx.stage === 'intro' &&
            (ctx.slots.hasIntroduced || ctx.slots.contactEstablished))
        ) {
          return legacyCrmDiscoveryBeat()
        }
        return {
          id: 'legacy_crm',
          policyId: 'beat:legacy:crm_pushed',
          template: shouldAsk(ctx, 'alternate')
            ? 'ack_fact_ask'
            : 'ack_fact_statement',
          topic: 'journal',
          skipHook: false,
          skipTone: false,
          soft: false,
        }
      }
    }

    if (
      intentId === 'ask_competitors' ||
      intentId === 'ask_implementation' ||
      intentId === 'ask_security' ||
      intentId === 'handle_objection' ||
      intentId === 'doubt' ||
      intentId === 'authority'
    ) {
      const ask = shouldAsk(ctx, 'alternate')
      return {
        id: 'objection',
        policyId: `beat:objection:${intentId}`,
        template: withAskTemplate(ask, 'ack_fact_ask', 'ack_fact_statement'),
        topic:
          intentId === 'ask_implementation'
            ? 'admin'
            : intentId === 'ask_competitors'
              ? 'journal'
              : topic,
        skipHook: false,
        skipTone: false,
        soft: false,
      }
    }
  }

  if (intentId === 'busy') {
    return {
      id: 'busy',
      policyId: 'beat:busy',
      template: shouldAsk(ctx, 'prefer') ? 'ack_ask' : 'ack_statement',
      topic: 'generic',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  if (intentId === 'clarify' || intentId === 'smalltalk') {
    return {
      id: 'clarify',
      policyId: 'beat:clarify',
      template: shouldAsk(ctx, 'alternate') ? 'ack_ask' : 'ack_statement',
      topic: 'generic',
      skipHook: true,
      skipTone: true,
      soft: true,
    }
  }

  return null
}
