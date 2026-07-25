/**
 * Политика ответа: beat-planner → шаблон со слотами.
 * Legacy-пулы оставлены только как аварийный fallback.
 */
import type { DialogueContext, SalesStage } from './machine'
import { markFollowUpAsked, withAskMemory, withLastHook } from './machine'
import type { NluIntentId } from './training'
import {
  extractEntities,
  managerStatedPrice,
  pickContextHook,
  type MentionedEntity,
} from './entities'
import { applyToneModifier } from './tone'
import { planBeatWithMechanics, timingForBeat } from '../services/beatPlanner'
import { composeBeatReply } from './composeBeat'
import {
  extractCallerCompany,
  extractCallerFirstName,
  hasCallerIdentification,
} from './beats'
import personas from '../data/persona-overlays.json'

type PersonaBank = Record<
  string,
  { label?: string; intentReplies: Record<string, string[]> }
>

const personaBank = personas as PersonaBank

const PERSONA_KEY: Partial<Record<NluIntentId, string>> = {
  ask_price: 'price_inquiry',
  price_defense: 'price_objection',
  handle_objection: 'price_objection',
  ask_competitors: 'trust_competitors',
  ask_implementation: 'implementation_fear',
  ask_security: 'security_compliance',
  authority: 'authority_gate',
  doubt: 'doubt_skepticism',
}

const NEUTRAL: Record<string, string[]> = {
  marina: [
    'Уточните, пожалуйста: про потери заявок, цену или следующий шаг?',
    'Не совсем уловила. Какой один вопрос сейчас главный?',
  ],
  artem: [
    'Не поймал тезис. Цена, сравнение с текущей системой или слот?',
    'Сформулируйте одним предложением, что решаем на звонке.',
  ],
  generic: ['Уточните коротко: о чём речь — процесс, цена или демо?'],
}

function pick(pool: string[], used: string[]): string {
  if (pool.length === 0) return '…'
  const fresh = pool.filter((r) => !used.includes(r))
  const list = fresh.length > 0 ? fresh : pool
  return list[Math.floor(Math.random() * list.length)]!
}

function poolFor(clientId: string | undefined, map: Record<string, string[]>): string[] {
  if (clientId && map[clientId]) return map[clientId]!
  return map.generic ?? Object.values(map)[0] ?? ['…']
}

function personaReplies(clientId: string | undefined, key: string): string[] {
  if (!clientId) return []
  return personaBank[clientId]?.intentReplies?.[key] ?? []
}

function filterPriceBank(pool: string[], userText: string): string[] {
  if (!managerStatedPrice(userText)) return pool
  const filtered = pool.filter(
    (r) => !/девять\s*девять|9900|9\s*900/i.test(r),
  )
  return filtered.length >= 1 ? filtered : pool
}

function preferEntitiesForIntent(intentId: NluIntentId): MentionedEntity[] {
  switch (intentId) {
    case 'ask_price':
    case 'price_defense':
      return ['цена', 'потери', 'неявки']
    case 'need_discovery':
      return ['конверсия', 'филиалы', 'whatsapp', 'неявки', 'администратор', 'журнал']
    case 'value_pitch':
      return ['crm', 'неявки', 'whatsapp']
    case 'closing':
      return ['демо']
    case 'ask_competitors':
      return ['crm', 'интеграция', 'филиалы']
    default:
      return []
  }
}

function composeReply(
  raw: string,
  ctx: DialogueContext,
  intentId: NluIntentId,
  opts: {
    skipHook?: boolean
    skipTone?: boolean
    soft?: boolean
  } = {},
): { text: string; hookEntity: MentionedEntity | null } {
  let body = raw.trim()
  let hookEntity: MentionedEntity | null = null

  const cold = ctx.mood.irritation >= 7
  const allowHook =
    !opts.skipHook &&
    !opts.soft &&
    !cold &&
    intentId !== 'closing' &&
    intentId !== 'greeting' &&
    intentId !== 'need_discovery' &&
    ctx.mentionedEntities.length > 0 &&
    Math.random() < 0.25

  if (allowHook && !/по whatsapp|по потерям|по цифрам|по демо|по неявкам/i.test(body)) {
    const picked = pickContextHook(
      ctx.mentionedEntities,
      preferEntitiesForIntent(intentId),
      ctx.lastHookEntity,
    )
    if (picked) {
      hookEntity = picked.entity
      body = `${picked.hook}${body.charAt(0).toLowerCase()}${body.slice(1)}`
    }
  }

  if (opts.skipTone || opts.soft) return { text: body, hookEntity }

  const allowPrefix =
    intentId !== 'closing' &&
    intentId !== 'need_discovery' &&
    intentId !== 'greeting' &&
    Math.random() < 0.25

  const toned = applyToneModifier(body, ctx.mood, { allowPrefix })
  return { text: toned.text, hookEntity }
}

/**
 * Политика ответа: (intent × stage × mood × memory) → реплика.
 */
export function selectReply(input: {
  intentId: NluIntentId
  ctx: DialogueContext
  clientId?: string
  usedReplies: string[]
  isNonsense: boolean
  isDeveloped: boolean
  userText?: string
  isOpening?: boolean
}): {
  reply: string
  policyId: string
  ctxPatch?: DialogueContext
  typingDelayMs: number
  clientReading: boolean
} {
  const {
    intentId,
    ctx,
    clientId,
    usedReplies,
    isNonsense,
    isDeveloped,
    userText = '',
    isOpening = false,
  } = input
  const used = usedReplies.slice(-24)
  const turnEntities = userText ? extractEntities(userText) : []

  const finish = (
    raw: string,
    policyId: string,
    opts: {
      skipHook?: boolean
      skipTone?: boolean
      soft?: boolean
      askUsed?: string | null
      hadAsk?: boolean
      listeningAckUsed?: string | null
      typingDelayMs?: number
      clientReading?: boolean
    } = {},
    extraPatch?: DialogueContext,
  ) => {
    let baseCtx = extraPatch ?? ctx
    baseCtx = withAskMemory(
      baseCtx,
      opts.askUsed ?? null,
      opts.hadAsk ?? /\?\s*$/.test(raw.trim()),
      opts.listeningAckUsed ?? null,
      raw,
    )
    const { text, hookEntity } = composeReply(raw, baseCtx, intentId, opts)
    const ctxPatch = hookEntity
      ? withLastHook(baseCtx, hookEntity)
      : baseCtx

    return {
      reply: text,
      policyId,
      ctxPatch,
      typingDelayMs: opts.typingDelayMs ?? 1400,
      clientReading: opts.clientReading ?? false,
    }
  }

  const beat = planBeatWithMechanics({
    intentId,
    ctx,
    userText,
    isNonsense,
    isDeveloped,
    isOpening,
  })

  const timing = timingForBeat(beat, { isDeveloped, isOpening })

  if (beat) {
    const composed = composeBeatReply(beat, clientId, used, {
      usedAsks: ctx.usedAsks ?? [],
      usedListeningAcks: ctx.usedListeningAcks ?? [],
      usedPainFacts: ctx.usedPainFacts ?? [],
      usedObjections: ctx.usedObjections ?? [],
      entities: turnEntities,
      irritation: ctx.mood.irritation,
      userText,
      alreadyGreeted:
        // Opening сам здоровается; дальше «Добрый день» не повторяем
        !isOpening &&
        (Boolean(ctx.slots.greeted) ||
          ctx.turn >= 1 ||
          ctx.stage !== 'intro'),
      turn: ctx.turn,
      mentionedFigures: ctx.mentionedFigures ?? [],
      postGateReserved: Boolean(ctx.slots.postGateReserved),
      hasIntroduced:
        Boolean(ctx.slots.hasIntroduced) ||
        Boolean(ctx.slots.contactEstablished),
      introAcknowledged:
        Boolean(ctx.slots.introAcknowledged) ||
        Boolean(ctx.slots.contactEstablished),
      managerName: ctx.slots.managerName ?? null,
      managerCompany: ctx.slots.managerCompany ?? null,
    })
    let patch = beat.markFollowUp ? markFollowUpAsked(ctx) : undefined
    if (
      beat.id === 'intro_open' ||
      beat.id === 'intro_hello' ||
      beat.id === 'intro_frame'
    ) {
      const base = patch ?? ctx
      const introNow = userText ? hasCallerIdentification(userText) : false
      const name =
        (userText ? extractCallerFirstName(userText) : null) ??
        base.slots.managerName
      const company =
        (userText ? extractCallerCompany(userText) : null) ??
        base.slots.managerCompany
      patch = {
        ...base,
        slots: {
          ...base.slots,
          greeted: true,
          // Рамка минут сама по себе ≠ представление
          contactEstablished:
            Boolean(base.slots.contactEstablished) || introNow,
          hasIntroduced: Boolean(base.slots.hasIntroduced) || introNow,
          managerName: name,
          managerCompany: company,
          introAcknowledged:
            Boolean(base.slots.introAcknowledged) ||
            Boolean(composed.introAcknowledged),
        },
      }
    }
    if (beat.id === 'contact_gate') {
      // Не фиксируем pain / contact — менеджер ещё не представился
      const base = patch ?? ctx
      patch = {
        ...base,
        slots: {
          ...base.slots,
          contactEstablished: false,
          hasIntroduced: false,
          postGateReserved: true,
          introAcknowledged: false,
        },
      }
    }
    // Сдержанный ответ после gate — снимаем флаг
    if (
      ctx.slots.postGateReserved &&
      beat.id !== 'contact_gate' &&
      (beat.id === 'discovery_pain' ||
        beat.policyId === 'beat:discovery_answer' ||
        beat.policyId === 'beat:intro_substance' ||
        beat.id === 'pitch' ||
        beat.id === 'post_pitch')
    ) {
      const base = patch ?? ctx
      patch = {
        ...base,
        slots: { ...base.slots, postGateReserved: false },
      }
    }
    // Представился в этой же реплике (даже с диагностикой) — контакт ок
    if (
      beat.id !== 'contact_gate' &&
      userText &&
      hasCallerIdentification(userText)
    ) {
      const base = patch ?? ctx
      const name =
        extractCallerFirstName(userText) ?? base.slots.managerName
      const company =
        extractCallerCompany(userText) ?? base.slots.managerCompany
      patch = {
        ...base,
        slots: {
          ...base.slots,
          contactEstablished: true,
          hasIntroduced: true,
          managerName: name,
          managerCompany: company,
          introAcknowledged:
            Boolean(base.slots.introAcknowledged) ||
            Boolean(composed.introAcknowledged),
        },
      }
    }
    // Mirroring / intro Ack на discovery без отдельного intro-бита
    if (
      beat.id !== 'contact_gate' &&
      (composed.introAcknowledged ||
        (composed.listeningAckUsed &&
          (ctx.slots.hasIntroduced ||
            (userText && hasCallerIdentification(userText)))))
    ) {
      const base = patch ?? ctx
      const name =
        (userText ? extractCallerFirstName(userText) : null) ??
        base.slots.managerName
      const company =
        (userText ? extractCallerCompany(userText) : null) ??
        base.slots.managerCompany
      patch = {
        ...base,
        slots: {
          ...base.slots,
          managerName: name,
          managerCompany: company,
          introAcknowledged:
            Boolean(base.slots.introAcknowledged) ||
            Boolean(composed.introAcknowledged) ||
            Boolean(composed.listeningAckUsed),
        },
      }
    }
    if (beat.id === 'persona_pushback') {
      const base = patch ?? ctx
      patch = {
        ...base,
        slots: { ...base.slots, personaPushbackShown: true },
      }
    }
    if (
      beat.id === 'objection_busy' ||
      beat.id === 'objection_skepticism'
    ) {
      const base = patch ?? ctx
      // Возражение показано — hasHandledObjection НЕ ставим (только после ответа менеджера)
      patch = {
        ...base,
        slots: { ...base.slots, personaPushbackShown: true },
      }
    }
    if (beat.id === 'legacy_crm') {
      const base = patch ?? ctx
      patch = {
        ...base,
        slots: {
          ...base.slots,
          legacyCrmRaised: true,
          personaPushbackShown: true,
        },
      }
    }
    if (beat.id === 'legacy_crm_discovery') {
      const base = patch ?? ctx
      patch = {
        ...base,
        slots: {
          ...base.slots,
          legacyCrmRaised: true,
        },
      }
    }
    if (beat.id === 'legacy_replacement_error') {
      const base = patch ?? ctx
      patch = {
        ...base,
        slots: {
          ...base.slots,
          legacyCrmRaised: true,
          replacementPitchError: true,
          personaPushbackShown: true,
        },
        mood: {
          ...base.mood,
          irritation: Math.min(10, (base.mood.irritation ?? 0) + 1.5),
          trust: Math.max(0, (base.mood.trust ?? 5) - 1),
        },
      }
    }
    if (beat.id === 'legacy_integration_ok') {
      const base = patch ?? ctx
      patch = {
        ...base,
        slots: {
          ...base.slots,
          legacyCrmRaised: true,
          integrationPitchOk: true,
          objectionHandled: true,
        },
      }
    }
    return finish(
      composed.text,
      beat.policyId,
      {
        skipHook: beat.skipHook,
        skipTone: beat.skipTone,
        soft: beat.soft,
        askUsed: composed.askUsed,
        hadAsk: composed.hadAsk,
        listeningAckUsed: composed.listeningAckUsed,
        typingDelayMs: timing.delayMs,
        clientReading: timing.reading,
      },
      patch,
    )
  }

  // Legacy fallback — редкие кейсы без beat
  const key = PERSONA_KEY[intentId]
  if (key) {
    let fromPersona = personaReplies(clientId, key)
    if (key === 'price_inquiry' || key === 'price_objection') {
      fromPersona = filterPriceBank(fromPersona, userText)
    }
    if (fromPersona.length > 0) {
      return finish(pick(fromPersona, used), `persona:${key}`, {
        skipHook: true,
        soft: true,
        typingDelayMs: timing.delayMs,
        clientReading: timing.reading,
      })
    }
  }

  return finish(pick(poolFor(clientId, NEUTRAL), used), 'fallback_clarify', {
    skipHook: true,
    soft: true,
    typingDelayMs: 1200,
    clientReading: false,
  })
}

export function stageToScriptStep(stage: SalesStage): number {
  switch (stage) {
    case 'intro':
      return 0
    case 'discovery':
      return 1
    case 'presentation':
      return 2
    case 'objection':
      return 3
    case 'closing':
      return 4
    case 'ended':
      return 5
  }
}
