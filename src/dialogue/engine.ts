import { classifyIntent, warmNlu } from './nlu'
import {
  applyManagerTurn,
  initialContext,
  type DialogueContext,
} from './machine'
import { selectReply, stageToScriptStep } from './policy'
import {
  extractEntities,
  hasExplicitDateTimeSlot,
  offersDemoSlot,
  isSlotTimeInput,
} from './entities'
import {
  isDevelopedArgument,
  isNonsenseSpam,
  isAggression,
} from '../services/intentMatcher'
import { needsContactGate } from './beats'
import {
  toxicityTerminateReply,
  toxicityWarningReply,
  isSessionLocked,
} from './toxicity'
import { OFFTOPIC_TERMINATE_REPLY } from '../services/offTopicDetect'
import type { Intent, SmartReplyResult } from '../types'
import type { NluIntentId } from './training'

export type { DialogueContext }
export { initialContext, warmNlu }

export type EngineInput = {
  userText: string
  clientId: string
  dialogueState?: DialogueContext | null
  usedClientReplies?: string[]
}

export type EngineResult = SmartReplyResult & {
  dialogueState: DialogueContext
  nluScore: number
  policyId: string
  stage: DialogueContext['stage']
  typingDelayMs: number
  clientReading: boolean
}

function toLegacyIntent(id: NluIntentId): Intent {
  switch (id) {
    case 'greeting':
      return 'greeting'
    case 'ask_price':
    case 'price_defense':
      return 'price'
    case 'need_discovery':
      return 'discovery'
    case 'value_pitch':
    case 'handle_objection':
    case 'ask_competitors':
    case 'ask_implementation':
    case 'ask_security':
      return 'objection'
    case 'closing':
      return 'close'
    case 'aggression':
    case 'nonsense':
    case 'smalltalk':
    case 'busy':
    case 'doubt':
    case 'authority':
    case 'clarify':
      return 'confused'
    default:
      return 'unknown'
  }
}

function toIntentLogId(policyId: string, intentId: NluIntentId): string {
  if (policyId.startsWith('developed_argument')) return 'developed_argument'
  if (policyId === 'nonsense' || intentId === 'nonsense') return 'nonsense_spam'
  if (policyId === 'early_price_block') return 'price_inquiry'
  if (intentId === 'ask_price') return 'price_inquiry'
  if (intentId === 'price_defense' || intentId === 'handle_objection') {
    return 'price_objection'
  }
  if (intentId === 'need_discovery') return 'need_discovery'
  if (intentId === 'value_pitch') return 'product_pitch_response'
  if (intentId === 'closing') return 'closing'
  if (intentId === 'ask_competitors') return 'trust_competitors'
  if (intentId === 'greeting') return 'greeting'
  if (intentId === 'aggression') return 'aggression_pushback'
  return intentId
}

/**
 * Оркестратор: nonsense → NLU(+multi) → policy(hooks/tone/follow-up) → FSM.
 */
export function runDialogueTurn(input: EngineInput): EngineResult {
  const {
    userText,
    clientId,
    dialogueState,
    usedClientReplies = [],
  } = input

  let ctx = dialogueState ?? initialContext(clientId)
  if (ctx.clientId !== clientId) {
    ctx = initialContext(clientId)
  }

  // Миграция старых snapshot без новых полей
  if (!ctx.mentionedEntities) ctx = { ...ctx, mentionedEntities: [] }
  if (!ctx.mentionedFigures) ctx = { ...ctx, mentionedFigures: [] }
  if (ctx.lastHookEntity === undefined) ctx = { ...ctx, lastHookEntity: null }
  if (!ctx.usedAsks) ctx = { ...ctx, usedAsks: [] }
  if (!ctx.usedListeningAcks) ctx = { ...ctx, usedListeningAcks: [] }
  if (ctx.lastReplyHadAsk == null) ctx = { ...ctx, lastReplyHadAsk: false }
  if (ctx.managerMonoStreak == null) ctx = { ...ctx, managerMonoStreak: 0 }
  if (ctx.warningCount == null) ctx = { ...ctx, warningCount: 0 }
  if (!ctx.sessionStatus) ctx = { ...ctx, sessionStatus: 'active' }
  if (ctx.failReason === undefined) ctx = { ...ctx, failReason: null }
  if (ctx.slots && ctx.slots.followUpAsked == null) {
    ctx = {
      ...ctx,
      slots: { ...ctx.slots, followUpAsked: false },
    }
  }
  if (ctx.slots && ctx.slots.personaPushbackShown == null) {
    ctx = {
      ...ctx,
      slots: { ...ctx.slots, personaPushbackShown: false },
    }
  }
  if (ctx.slots && ctx.slots.closingAttempts == null) {
    ctx = {
      ...ctx,
      slots: { ...ctx.slots, closingAttempts: 0 },
    }
  }
  if (ctx.slots && ctx.slots.hasHandledObjection == null) {
    ctx = {
      ...ctx,
      slots: { ...ctx.slots, hasHandledObjection: false },
    }
  }
  if (ctx.slots && ctx.slots.contactEstablished == null) {
    ctx = {
      ...ctx,
      slots: { ...ctx.slots, contactEstablished: false },
    }
  }
  if (ctx.slots && ctx.slots.hasIntroduced == null) {
    ctx = {
      ...ctx,
      slots: {
        ...ctx.slots,
        hasIntroduced: Boolean(ctx.slots.contactEstablished),
      },
    }
  }
  if (ctx.slots && ctx.slots.postGateReserved == null) {
    ctx = {
      ...ctx,
      slots: { ...ctx.slots, postGateReserved: false },
    }
  }
  if (ctx.slots && ctx.slots.managerName === undefined) {
    ctx = {
      ...ctx,
      slots: {
        ...ctx.slots,
        managerName: null,
        managerCompany: null,
        introAcknowledged: false,
      },
    }
  }
  if (ctx.slots && ctx.slots.introAcknowledged == null) {
    ctx = {
      ...ctx,
      slots: { ...ctx.slots, introAcknowledged: false },
    }
  }
  if (ctx.slots && ctx.slots.legacyCrmRaised == null) {
    ctx = {
      ...ctx,
      slots: {
        ...ctx.slots,
        legacyCrmRaised: false,
        replacementPitchError: false,
        integrationPitchOk: false,
      },
    }
  }

  // Guard: ответ менеджера ПОСЛЕ pushback → hasHandledObjection = true
  // (до planBeat, чтобы повторный Zoom в этой же реплике мог пройти в AGREED)
  if (
    ctx.slots.personaPushbackShown &&
    !ctx.slots.hasHandledObjection &&
    userText.trim().length > 0
  ) {
    ctx = {
      ...ctx,
      slots: { ...ctx.slots, hasHandledObjection: true },
    }
  }

  // Сессия уже провалена (этика / off-topic) — не продолжаем диалог
  if (isSessionLocked(ctx.sessionStatus, ctx.failReason)) {
    const offtopic =
      ctx.sessionStatus === 'terminated_offtopic' ||
      ctx.failReason === 'terminated_offtopic'
    if (offtopic) {
      return {
        reply: OFFTOPIC_TERMINATE_REPLY,
        nextStep: stageToScriptStep('ended'),
        intent: 'confused',
        intentId: 'offtopic_confused',
        dialogueState: {
          ...ctx,
          stage: 'ended',
          sessionStatus: 'terminated_offtopic',
          failReason: 'terminated_offtopic',
        },
        nluScore: 1,
        policyId: 'offtopic:terminated',
        stage: 'ended',
        typingDelayMs: 900,
        clientReading: false,
      }
    }
    return {
      reply: toxicityTerminateReply(),
      nextStep: stageToScriptStep('ended'),
      intent: 'confused',
      intentId: 'aggression_pushback',
      dialogueState: {
        ...ctx,
        stage: 'ended',
        sessionStatus: 'terminated_etiquette',
        failReason: ctx.failReason ?? 'terminated_etiquette',
        warningCount: Math.max(ctx.warningCount, 2),
      },
      nluScore: 1,
      policyId: 'toxicity:terminated',
      stage: 'ended',
      typingDelayMs: 800,
      clientReading: false,
    }
  }

  const aggression = isAggression(userText)
  const slotTime =
    isSlotTimeInput(userText) &&
    (ctx.slots.demoOffered || ctx.stage === 'closing')

  // Хамство важнее spam-фильтра; короткое время слота — не nonsense
  // Intro-gate важнее nonsense: «Сколько кресел?» без ID ≠ spam
  const nonsenseRaw =
    !aggression && !slotTime && isNonsenseSpam(userText)
  const nonsense =
    nonsenseRaw &&
    !needsContactGate(ctx, userText)
  const developed =
    !nonsense && !aggression && !slotTime && isDevelopedArgument(userText)
  const entities = nonsense || aggression || slotTime ? [] : extractEntities(userText)

  let intentId: NluIntentId
  let nluScore = 1

  if (aggression) {
    intentId = 'aggression'
  } else if (slotTime) {
    intentId = 'closing'
    nluScore = 1
  } else if (nonsense) {
    intentId = 'nonsense'
  } else {
    const nlu = classifyIntent(userText, ctx.stage)
    intentId = nlu.intentId
    nluScore = nlu.score
    // Длинный содержательный текст не должен остаться «greeting»
    if (
      developed &&
      (intentId === 'clarify' ||
        intentId === 'nonsense' ||
        intentId === 'greeting' ||
        intentId === 'smalltalk' ||
        intentId === 'busy')
    ) {
      if (offersDemoSlot(userText)) {
        intentId = 'closing'
      } else {
        const pain =
          /(потер|теря|заявк|неявк|отмен|журнал|whatsapp|ватсап|запис|выручк|недополуча)/i.test(
            userText,
          )
        intentId = pain ? 'need_discovery' : 'value_pitch'
      }
      nluScore = Math.max(nluScore, 0.75)
    } else if (
      offersDemoSlot(userText) &&
      intentId !== 'aggression' &&
      (ctx.slots.painFound ||
        ctx.slots.priceDiscussed ||
        ctx.slots.demoOffered ||
        ctx.stage === 'presentation' ||
        ctx.stage === 'objection' ||
        ctx.stage === 'closing')
    ) {
      intentId = 'closing'
      nluScore = Math.max(nluScore, 0.8)
    }
  }

  // ── Toxicity: 1-е → warning, 2-е → TERMINATED_ETIQUETTE ──
  if (aggression) {
    const prevWarnings = ctx.warningCount ?? 0
    const nextWarnings = prevWarnings >= 1 ? 2 : 1
    let nextCtx = applyManagerTurn(ctx, {
      intentId: 'aggression',
      confidence: 1,
      isNonsense: false,
      isDeveloped: false,
      textLen: userText.trim().length,
      text: userText,
      entities: [],
    })

    if (nextWarnings >= 2) {
      nextCtx = {
        ...nextCtx,
        stage: 'ended',
        warningCount: 2,
        sessionStatus: 'terminated_etiquette',
        failReason: 'terminated_etiquette',
        lastIntent: 'aggression',
      }
      return {
        reply: toxicityTerminateReply(),
        nextStep: stageToScriptStep('ended'),
        intent: 'confused',
        intentId: 'aggression_pushback',
        dialogueState: nextCtx,
        nluScore: 1,
        policyId: 'toxicity:terminate',
        stage: 'ended',
        typingDelayMs: 800,
        clientReading: false,
      }
    }

    nextCtx = {
      ...nextCtx,
      warningCount: 1,
      sessionStatus: 'warning',
      failReason: null,
      lastIntent: 'aggression',
    }
    return {
      reply: toxicityWarningReply(clientId),
      nextStep: stageToScriptStep(nextCtx.stage),
      intent: 'confused',
      intentId: 'aggression_pushback',
      dialogueState: nextCtx,
      nluScore: 1,
      policyId: 'toxicity:warning',
      stage: nextCtx.stage,
      typingDelayMs: 1000,
      clientReading: false,
    }
  }

  const selected = selectReply({
    intentId,
    ctx,
    clientId,
    usedReplies: usedClientReplies,
    isNonsense: nonsense,
    isDeveloped: developed,
    userText,
    isOpening: false,
  })

  let nextCtx = applyManagerTurn(ctx, {
    intentId,
    confidence: nluScore,
    isNonsense: nonsense,
    isDeveloped: developed,
    textLen: userText.trim().length,
    text: userText,
    entities,
  })

  if (selected.ctxPatch) {
    nextCtx = {
      ...nextCtx,
      slots: {
        ...nextCtx.slots,
        greeted:
          nextCtx.slots.greeted ||
          selected.ctxPatch.slots?.greeted ||
          false,
        contactEstablished:
          nextCtx.slots.contactEstablished ||
          selected.ctxPatch.slots?.contactEstablished ||
          false,
        hasIntroduced:
          nextCtx.slots.hasIntroduced ||
          selected.ctxPatch.slots?.hasIntroduced ||
          nextCtx.slots.contactEstablished ||
          selected.ctxPatch.slots?.contactEstablished ||
          false,
        postGateReserved:
          selected.ctxPatch.slots?.postGateReserved ??
          nextCtx.slots.postGateReserved ??
          false,
        followUpAsked:
          selected.ctxPatch.slots?.followUpAsked ||
          nextCtx.slots.followUpAsked,
        personaPushbackShown:
          selected.ctxPatch.slots?.personaPushbackShown ||
          nextCtx.slots.personaPushbackShown,
        hasHandledObjection:
          nextCtx.slots.hasHandledObjection ||
          selected.ctxPatch.slots?.hasHandledObjection ||
          false,
        // attempts считает только applyManagerTurn (patch не должен затирать 0-ом)
        closingAttempts: nextCtx.slots.closingAttempts ?? 0,
        managerName:
          selected.ctxPatch.slots?.managerName ??
          nextCtx.slots.managerName ??
          null,
        managerCompany:
          selected.ctxPatch.slots?.managerCompany ??
          nextCtx.slots.managerCompany ??
          null,
        introAcknowledged:
          Boolean(nextCtx.slots.introAcknowledged) ||
          Boolean(selected.ctxPatch.slots?.introAcknowledged),
      },
      lastHookEntity:
        selected.ctxPatch.lastHookEntity ?? nextCtx.lastHookEntity ?? null,
      usedAsks: selected.ctxPatch.usedAsks ?? nextCtx.usedAsks,
      usedListeningAcks:
        selected.ctxPatch.usedListeningAcks ?? nextCtx.usedListeningAcks,
      usedPainFacts:
        selected.ctxPatch.usedPainFacts ?? nextCtx.usedPainFacts,
      usedObjections:
        selected.ctxPatch.usedObjections ?? nextCtx.usedObjections,
      lastReplyHadAsk:
        selected.ctxPatch.lastReplyHadAsk ?? nextCtx.lastReplyHadAsk,
      managerMonoStreak:
        selected.ctxPatch.managerMonoStreak ?? nextCtx.managerMonoStreak,
    }
  }

  // Contact gate: не считаем боль «найденной», не открываем контакт, stage = intro
  if (selected.policyId === 'beat:contact_gate') {
    nextCtx = {
      ...nextCtx,
      stage: 'intro',
      slots: {
        ...nextCtx.slots,
        painFound: ctx.slots.painFound,
        contactEstablished: false,
        hasIntroduced: false,
        postGateReserved: true,
        introAcknowledged: false,
      },
    }
  }

  // Демо принято / слот подтверждён — SESSION_COMPLETE только при дне+времени
  if (
    (selected.policyId === 'beat:closing_confirm' ||
      selected.policyId === 'beat:closing_ok') &&
    hasExplicitDateTimeSlot(userText)
  ) {
    nextCtx = {
      ...nextCtx,
      stage: 'closing',
      sessionStatus: 'completed',
      slots: { ...nextCtx.slots, demoOffered: true },
    }
  }

  return {
    reply: selected.reply,
    nextStep: stageToScriptStep(nextCtx.stage),
    intent: toLegacyIntent(intentId),
    intentId: toIntentLogId(selected.policyId, intentId),
    dialogueState: nextCtx,
    nluScore,
    policyId: selected.policyId,
    stage: nextCtx.stage,
    typingDelayMs: selected.typingDelayMs,
    clientReading: selected.clientReading,
  }
}

/** Открытие чата — первая реплика клиента (beat intro_open). */
export function openingReply(clientId: string): EngineResult {
  const ctx = initialContext(clientId)
  const selected = selectReply({
    intentId: 'greeting',
    ctx,
    clientId,
    usedReplies: [],
    isNonsense: false,
    isDeveloped: false,
    userText: '',
    isOpening: true,
  })
  const dialogueState = selected.ctxPatch ?? ctx
  return {
    reply: selected.reply,
    nextStep: stageToScriptStep(dialogueState.stage),
    intent: 'greeting',
    intentId: 'greeting',
    dialogueState,
    nluScore: 1,
    policyId: selected.policyId,
    stage: dialogueState.stage,
    typingDelayMs: selected.typingDelayMs,
    clientReading: selected.clientReading,
  }
}
