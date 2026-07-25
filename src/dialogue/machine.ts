/**
 * FSM продажи (логика переходов).
 * XState-машина держит контракт состояний; applyManagerTurn —
 * сериализуемый reducer для React (snapshot между ходами).
 */
import { assign, createMachine } from 'xstate'
import type { NluIntentId } from './training'
import {
  extractEntities,
  extractMentionedFigures,
  mergeEntities,
  mergeMentionedFigures,
  type MentionedEntity,
} from './entities'
import {
  coolIrritationWithInertia,
  heatIrritation,
} from './emotionInertia'
import { nextMonoStreak } from './pacing'
import { offersDemoSlot } from './entities'
import { mergePainKeys } from './painFacts'
import { mergeUsedObjections } from './objectionMemory'
import {
  isFullReplacementPitch,
  isIntegrationPitch,
  mentionsLegacyCrm,
} from './intents'

function textHasIntroduction(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  if (
    /(меня\s+зовут|я\s+из\b|из\s+компани|компани[яи]|дента\s*crm|дентаcrm|автоматизац|насч[её]т\s+запис|по\s+поводу)/i.test(
      t,
    )
  ) {
    return true
  }
  if (/(?:^|[^a-zа-я0-9])это\s+[a-zа-яё][a-zа-яё\d-]{1,24}\b/i.test(t)) {
    return true
  }
  if (
    /(здравств|добр(ый|ое|ого)|привет)/i.test(t) &&
    /(компани|дента|зовут|это\s+[a-zа-яё])/i.test(t)
  ) {
    return true
  }
  return false
}

export type SalesStage =
  | 'intro'
  | 'discovery'
  | 'presentation'
  | 'objection'
  | 'closing'
  | 'ended'

export type ClientMood = {
  trust: number
  interest: number
  irritation: number
}

export type DialogueSlots = {
  greeted: boolean
  /** Менеджер представился / задал рамку звонка — можно раскрывать боли */
  contactEstablished: boolean
  /**
   * Явный флаг представления (синхрон с contactEstablished).
   * Пока false — discovery/pain не открываем.
   */
  hasIntroduced: boolean
  /**
   * После contact_gate следующий содержательный ход — сдержанный
   * (не прыгать сразу в «тонем / стыдно»).
   */
  postGateReserved: boolean
  painFound: boolean
  priceAskedEarly: boolean
  priceDiscussed: boolean
  pitched: boolean
  objectionHandled: boolean
  demoOffered: boolean
  developedArgument: boolean
  nonsenseStreak: number
  /** Клиент уже задал follow-up после презентации */
  followUpAsked: boolean
  /**
   * Скептичная/занятая персона уже выразила сомнение
   * или тайм-прессинг (хотя бы раз за сессию).
   */
  personaPushbackShown: boolean
  /**
   * Менеджер уже ответил на возражение персоны.
   * Guard на AGREED / closing_ok: без этого флага демо не принимаем.
   */
  hasHandledObjection: boolean
  /** Сколько раз менеджер уже предлагал демо / слот (Zoom, время). */
  closingAttempts: number
  /** Подряд идущие off-topic / невалидные реплики (сброс на sales). */
  offTopicCount: number
  /** Имя менеджера из представления — для mirroring в Ack. */
  managerName: string | null
  /** Компания менеджера (ДентаCRM и т.п.). */
  managerCompany: string | null
  /**
   * Клиент хотя бы раз узнал представление в Ack.
   * Пока false — не прыгаем в глубокие discovery-статы.
   */
  introAcknowledged: boolean
  /** Клиент озвучил «у нас уже 1С/Инфодент». */
  legacyCrmRaised: boolean
  /** Менеджер предложил полную замену МИС — ошибка. */
  replacementPitchError: boolean
  /** Менеджер предложил интеграцию/модуль поверх МИС. */
  integrationPitchOk: boolean
}

export type DialogueContext = {
  stage: SalesStage
  mood: ClientMood
  slots: DialogueSlots
  /** Память сущностей из реплик менеджера */
  mentionedEntities: MentionedEntity[]
  /**
   * Цифры/суммы, которые менеджер реально назвал в этой сессии.
   * Нельзя ссылаться на «50 тысяч», если их здесь нет.
   */
  mentionedFigures: string[]
  /** Последний крючок — чтобы не повторять */
  lastHookEntity: MentionedEntity | null
  /** Уже заданные вопросы клиента — антиповтор */
  usedAsks: string[]
  /** Уже использованные Active Listening Ack — антиповтор «То есть вы про…» */
  usedListeningAcks: string[]
  /**
   * Ключи раскрытых болей («irina_manual», «whatsapp_hang»…) —
   * не пересказывать ту же боль другими словами.
   */
  usedPainFacts: string[]
  /**
   * Типы уже показанных возражений (PATIENT_IN_CHAIR, GIVE_ESSENCE…) —
   * не крутить одну и ту же претензию после ответа менеджера.
   */
  usedObjections: string[]
  /** Прошлая реплика клиента заканчивалась вопросом */
  lastReplyHadAsk: boolean
  /**
   * Сколько ходов подряд менеджер говорил без вопроса к клиенту.
   * ≥2 → pacing interrupt (см. beatPlanner).
   */
  managerMonoStreak: number
  turn: number
  lastIntent: NluIntentId | null
  clientId: string
  /** Хамство / мат: 0 → 1 предупреждение → 2 провал сессии */
  warningCount: number
  sessionStatus:
    | 'active'
    | 'warning'
    | 'failed'
    | 'completed'
    | 'terminated_etiquette'
    | 'terminated_offtopic'
  failReason:
    | 'toxicity_limit_exceeded'
    | 'terminated_etiquette'
    | 'terminated_offtopic'
    | null
}

export type TurnInput = {
  intentId: NluIntentId
  confidence: number
  isNonsense: boolean
  isDeveloped: boolean
  textLen: number
  /** Сырой текст менеджера — для извлечения сущностей */
  text?: string
  entities?: MentionedEntity[]
}

function clamp(n: number, min = 0, max = 10): number {
  return Math.min(max, Math.max(min, n))
}

export function initialContext(clientId = 'marina'): DialogueContext {
  return {
    stage: 'intro',
    mood: { trust: 5, interest: 4, irritation: 2 },
    slots: {
      greeted: false,
      contactEstablished: false,
      hasIntroduced: false,
      postGateReserved: false,
      painFound: false,
      priceAskedEarly: false,
      priceDiscussed: false,
      pitched: false,
      objectionHandled: false,
      demoOffered: false,
      developedArgument: false,
      nonsenseStreak: 0,
      followUpAsked: false,
      personaPushbackShown: false,
      hasHandledObjection: false,
      closingAttempts: 0,
      offTopicCount: 0,
      managerName: null,
      managerCompany: null,
      introAcknowledged: false,
      legacyCrmRaised: false,
      replacementPitchError: false,
      integrationPitchOk: false,
    },
    mentionedEntities: [],
    mentionedFigures: [],
    lastHookEntity: null,
    usedAsks: [],
    usedListeningAcks: [],
    usedPainFacts: [],
    usedObjections: [],
    lastReplyHadAsk: false,
    managerMonoStreak: 0,
    turn: 0,
    lastIntent: null,
    clientId,
    warningCount: 0,
    sessionStatus: 'active',
    failReason: null,
  }
}

function nextStageAfterIntent(
  stage: SalesStage,
  intentId: NluIntentId,
  slots: DialogueSlots,
): SalesStage {
  if (stage === 'ended') return 'ended'

  // Absolute intro guard: без представления не уходим с intro/раннего discovery
  if (!slots.contactEstablished && !slots.hasIntroduced) {
    if (intentId === 'aggression') return stage
    // Поздняя воронка (демо/возражения) — не откатываем в intro
    if (
      stage === 'presentation' ||
      stage === 'objection' ||
      stage === 'closing' ||
      slots.demoOffered ||
      slots.pitched
    ) {
      // fall through
    } else {
      return 'intro'
    }
  }

  switch (intentId) {
    case 'aggression':
      // Провал сессии решает warningCount в engine; здесь этап не рвём на 1-м ударе
      return stage
    case 'greeting':
      return stage === 'intro' ? 'discovery' : stage
    case 'need_discovery':
      return stage === 'intro' || stage === 'discovery' ? 'discovery' : stage
    case 'value_pitch':
    case 'price_defense':
    case 'handle_objection':
      if (stage === 'intro') return 'discovery'
      if (stage === 'discovery') return 'presentation'
      if (stage === 'presentation') return 'objection'
      return stage
    case 'ask_price':
      if (!slots.painFound && (stage === 'intro' || stage === 'discovery')) {
        return 'discovery'
      }
      return stage === 'presentation' || stage === 'objection' ? 'objection' : stage
    case 'ask_competitors':
    case 'ask_implementation':
    case 'ask_security':
    case 'doubt':
    case 'authority':
      return stage === 'intro' ? 'discovery' : 'objection'
    case 'closing':
      return 'closing'
    default:
      return stage
  }
}

export function reduceTurn(
  ctx: DialogueContext,
  input: TurnInput,
): DialogueContext {
  const mood = { ...ctx.mood }
  const slots = { ...ctx.slots }
  const { intentId } = input

  const freshEntities =
    input.entities ??
    (input.text && !input.isNonsense ? extractEntities(input.text) : [])
  const mentionedEntities = mergeEntities(ctx.mentionedEntities, freshEntities)
  const mentionedFigures = mergeMentionedFigures(
    ctx.mentionedFigures,
    input.text && !input.isNonsense ? extractMentionedFigures(input.text) : [],
  )

  slots.nonsenseStreak = input.isNonsense ? slots.nonsenseStreak + 1 : 0

  // Представление / рамка звонка в этой реплике → hasIntroduced
  if (
    input.text &&
    !input.isNonsense &&
    intentId !== 'aggression' &&
    textHasIntroduction(input.text)
  ) {
    slots.contactEstablished = true
    slots.hasIntroduced = true
  }

  const managerMonoStreak = input.text
    ? nextMonoStreak(ctx.managerMonoStreak ?? 0, input.text)
    : ctx.managerMonoStreak ?? 0

  // Emotion Inertia: копим cool/heat, при irr>5 cool ≤ 2 за ход
  let requestedCool = 0
  let heat = 0

  if (!input.isNonsense && intentId !== 'aggression') {
    requestedCool += 1.2
  }

  if (input.isDeveloped) {
    slots.developedArgument = true
    mood.trust = clamp(mood.trust + 1.2)
    mood.interest = clamp(mood.interest + 1)
    requestedCool += 0.8
  }

  switch (intentId) {
    case 'greeting':
      slots.greeted = true
      mood.trust = clamp(mood.trust + 0.4)
      requestedCool += 0.3
      break
    case 'need_discovery':
      // Без представления не считаем pain «найденной»
      if (slots.contactEstablished || slots.hasIntroduced) {
        slots.painFound = true
        mood.interest = clamp(mood.interest + 1.2)
        mood.trust = clamp(mood.trust + 0.6)
        requestedCool += 0.5
      }
      break
    case 'ask_price':
      if (!slots.painFound) {
        slots.priceAskedEarly = true
        heat += 0.8
        mood.trust = clamp(mood.trust - 0.5)
      } else {
        slots.priceDiscussed = true
        mood.interest = clamp(mood.interest + 0.3)
      }
      break
    case 'price_defense':
    case 'handle_objection':
      slots.objectionHandled = true
      slots.priceDiscussed = true
      mood.trust = clamp(mood.trust + 1)
      requestedCool += 0.6
      break
    case 'value_pitch':
      slots.pitched = true
      if (slots.painFound) {
        mood.interest = clamp(mood.interest + 1.1)
        mood.trust = clamp(mood.trust + 0.7)
      } else {
        heat += 0.4
      }
      break
    case 'ask_competitors':
      slots.legacyCrmRaised = true
      break
    case 'closing':
      slots.demoOffered = true
      slots.closingAttempts = (slots.closingAttempts ?? 0) + 1
      mood.interest = clamp(mood.interest + 0.8)
      requestedCool += 0.6
      break
    case 'aggression':
    case 'nonsense':
      heat += 2
      mood.trust = clamp(mood.trust - 1.5)
      break
    case 'smalltalk':
      if (ctx.stage === 'intro' || ctx.turn <= 2) {
        requestedCool += 0.2
      } else {
        heat += 0.5
      }
      break
    case 'doubt':
    case 'busy':
      mood.interest = clamp(mood.interest - 0.4)
      break
    default:
      break
  }

  // Стратегия МИС: замена vs интеграция (штраф / зачёт в слотах + настроение)
  if (
    input.text &&
    !input.isNonsense &&
    intentId !== 'aggression'
  ) {
    if (mentionsLegacyCrm(input.text) || intentId === 'ask_competitors') {
      slots.legacyCrmRaised = true
    }
    if (isFullReplacementPitch(input.text)) {
      slots.replacementPitchError = true
      slots.legacyCrmRaised = true
      heat += 2.2
      mood.trust = clamp(mood.trust - 1.8)
      mood.interest = clamp(mood.interest - 0.8)
    } else if (isIntegrationPitch(input.text)) {
      slots.integrationPitchOk = true
      slots.legacyCrmRaised = true
      slots.objectionHandled = true
      mood.trust = clamp(mood.trust + 1.0)
      mood.interest = clamp(mood.interest + 0.8)
      requestedCool += 0.7
    }
  }

  // Демо/слот в тексте при другом intent (например value_pitch + Zoom)
  if (
    intentId !== 'closing' &&
    intentId !== 'aggression' &&
    intentId !== 'nonsense' &&
    input.text &&
    offersDemoSlot(input.text)
  ) {
    slots.closingAttempts = (slots.closingAttempts ?? 0) + 1
  }

  if (heat > 0) heatIrritation(mood, heat)
  if (requestedCool > 0 && !input.isNonsense && intentId !== 'aggression') {
    coolIrritationWithInertia(mood, requestedCool)
  }

  return {
    ...ctx,
    stage: nextStageAfterIntent(ctx.stage, intentId, slots),
    mood,
    slots,
    mentionedEntities,
    mentionedFigures,
    managerMonoStreak,
    turn: ctx.turn + 1,
    lastIntent: intentId,
  }
}

/** XState-обёртка над тем же reducer (для отладки / визуализаторов). */
export const salesMachine = createMachine({
  id: 'salesRoleplay',
  initial: 'active',
  context: initialContext(),
  types: {} as {
    context: DialogueContext
    events:
      | { type: 'MANAGER_TURN'; input: TurnInput }
      | { type: 'RESET'; clientId: string }
  },
  states: {
    active: {
      on: {
        RESET: {
          actions: assign(({ event }) => initialContext(event.clientId)),
        },
        MANAGER_TURN: {
          actions: assign(({ context, event }) =>
            reduceTurn(context, event.input),
          ),
        },
      },
    },
  },
})

/** Применить ход менеджера (FSM-переход). */
export function applyManagerTurn(
  ctx: DialogueContext,
  input: TurnInput,
): DialogueContext {
  return reduceTurn(ctx, input)
}

export function markFollowUpAsked(ctx: DialogueContext): DialogueContext {
  return {
    ...ctx,
    slots: { ...ctx.slots, followUpAsked: true },
  }
}

export function withLastHook(
  ctx: DialogueContext,
  entity: MentionedEntity | null,
): DialogueContext {
  return { ...ctx, lastHookEntity: entity }
}

export function withAskMemory(
  ctx: DialogueContext,
  askUsed: string | null,
  hadAsk: boolean,
  listeningAckUsed: string | null = null,
  replyText: string | null = null,
): DialogueContext {
  const usedAsks = askUsed
    ? [...ctx.usedAsks.filter((a) => a !== askUsed), askUsed].slice(-16)
    : ctx.usedAsks
  const usedListeningAcks = listeningAckUsed
    ? [
        ...(ctx.usedListeningAcks ?? []).filter((a) => a !== listeningAckUsed),
        listeningAckUsed,
      ].slice(-12)
    : (ctx.usedListeningAcks ?? [])
  const usedPainFacts = replyText
    ? mergePainKeys(ctx.usedPainFacts, replyText)
    : (ctx.usedPainFacts ?? [])
  const usedObjections = replyText
    ? mergeUsedObjections(ctx.usedObjections, replyText)
    : (ctx.usedObjections ?? [])
  return {
    ...ctx,
    usedAsks,
    usedListeningAcks,
    usedPainFacts,
    usedObjections,
    lastReplyHadAsk: hadAsk,
  }
}
