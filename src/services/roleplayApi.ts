/**
 * Mock roleplay API: 2-strike profanity / etiquette guard (все персоны).
 * Strike 1 → warning (chat continues, script step не двигаем).
 * Strike 2+ → TERMINATED_ETIQUETTE.
 */
import type { DialogueSnapshot, SmartReplyResult } from '../types'
import { containsAbuseOrProfanity } from '../utils/abuseDetect'
import {
  initialContext,
  type DialogueContext,
} from '../dialogue/machine'
import { stageToScriptStep } from '../dialogue/policy'
import { fillGender, voiceGenderForClient } from '../dialogue/gender'
import { isOffTopicMessage, OFFTOPIC_TERMINATE_REPLY } from './offTopicDetect'

export function abuseWarningReply(clientId?: string): string {
  return fillGender(
    'Давайте держать рамки делового общения. Я здесь для обсуждения задач клиники. Если продолжится хамство — {вынужден} буду завершить разговор.',
    voiceGenderForClient(clientId),
  )
}

export const ABUSE_WARNING_REPLY = abuseWarningReply('marina')

export const ABUSE_TERMINATE_REPLY =
  'Вы адекватны? Я завершаю этот разговор.'

export function isAbusiveInput(text: string): boolean {
  return containsAbuseOrProfanity(text)
}

export function countAbuseInMessages(texts: string[]): number {
  return texts.filter((t) => containsAbuseOrProfanity(t)).length
}

/**
 * Сколько мат-реплик менеджера в истории, включая текущую (без двойного счёта).
 */
export function countSessionAbuse(input: {
  userText: string
  historyMessages: { role: string; text: string }[]
}): number {
  const managerTexts = input.historyMessages
    .filter((m) => m.role === 'manager')
    .map((m) => m.text)
  const last = managerTexts[managerTexts.length - 1]
  const withCurrent =
    last === input.userText
      ? managerTexts
      : [...managerTexts, input.userText]
  return countAbuseInMessages(withCurrent)
}

function baseCtx(
  clientId: string,
  dialogueState?: DialogueContext | DialogueSnapshot | null,
): DialogueContext {
  return (
    (dialogueState as DialogueContext | null) ?? initialContext(clientId)
  )
}

export function buildAbuseWarningResult(input: {
  clientId: string
  dialogueState?: DialogueContext | DialogueSnapshot | null
  /** Не двигать script step */
  scriptStep?: number
}): SmartReplyResult {
  const base = baseCtx(input.clientId, input.dialogueState)
  const dialogueState: DialogueContext = {
    ...base,
    sessionStatus: 'warning',
    failReason: null,
    warningCount: Math.max(base.warningCount ?? 0, 1),
    lastIntent: 'aggression',
  }

  return {
    reply: abuseWarningReply(input.clientId),
    nextStep:
      input.scriptStep ?? stageToScriptStep(dialogueState.stage),
    intent: 'confused',
    intentId: 'aggression_pushback',
    dialogueState: dialogueState as SmartReplyResult['dialogueState'],
    nluScore: 1,
    policyId: 'toxicity:warning',
    typingDelayMs: 1000,
    clientReading: false,
  }
}

export function buildAbuseTerminationResult(input: {
  clientId: string
  dialogueState?: DialogueContext | DialogueSnapshot | null
  scriptStep?: number
}): SmartReplyResult {
  const base = baseCtx(input.clientId, input.dialogueState)
  const dialogueState: DialogueContext = {
    ...base,
    stage: 'ended',
    sessionStatus: 'terminated_etiquette',
    failReason: 'terminated_etiquette',
    warningCount: Math.max(base.warningCount ?? 0, 2),
    lastIntent: 'aggression',
  }

  return {
    reply: ABUSE_TERMINATE_REPLY,
    nextStep:
      input.scriptStep ?? stageToScriptStep('ended'),
    intent: 'confused',
    intentId: 'aggression_pushback',
    dialogueState: dialogueState as SmartReplyResult['dialogueState'],
    nluScore: 1,
    policyId: 'toxicity:terminate',
    typingDelayMs: 800,
    clientReading: false,
  }
}

/**
 * Guard до FSM / script: считает мат в истории менеджера + текущую реплику.
 * null → не мат, продолжаем обычный диалог персоны.
 */
export function resolveAbuseGuard(input: {
  userText: string
  clientId: string
  historyMessages: { role: string; text: string }[]
  dialogueState?: DialogueContext | DialogueSnapshot | null
  scriptStep?: number
}): SmartReplyResult | null {
  if (!containsAbuseOrProfanity(input.userText)) return null

  const abuseCount = countSessionAbuse({
    userText: input.userText,
    historyMessages: input.historyMessages,
  })

  if (abuseCount >= 2) {
    return buildAbuseTerminationResult({
      clientId: input.clientId,
      dialogueState: input.dialogueState,
      scriptStep: input.scriptStep,
    })
  }

  return buildAbuseWarningResult({
    clientId: input.clientId,
    dialogueState: input.dialogueState,
    scriptStep: input.scriptStep,
  })
}

// ── Off-topic: 3 strikes → TERMINATED_OFFTOPIC ──

export { OFFTOPIC_TERMINATE_REPLY }

export function buildOffTopicTerminationResult(input: {
  clientId: string
  dialogueState?: DialogueContext | DialogueSnapshot | null
  scriptStep?: number
  offTopicCount?: number
}): SmartReplyResult {
  const base = baseCtx(input.clientId, input.dialogueState)
  const count = Math.max(input.offTopicCount ?? 3, 3)
  const dialogueState: DialogueContext = {
    ...base,
    stage: 'ended',
    sessionStatus: 'terminated_offtopic',
    failReason: 'terminated_offtopic',
    slots: {
      ...base.slots,
      offTopicCount: count,
    },
    lastIntent: 'nonsense',
  }

  return {
    reply: OFFTOPIC_TERMINATE_REPLY,
    nextStep: input.scriptStep ?? stageToScriptStep('ended'),
    intent: 'confused',
    intentId: 'offtopic_confused',
    dialogueState: dialogueState as SmartReplyResult['dialogueState'],
    nluScore: 1,
    policyId: 'offtopic:terminate',
    typingDelayMs: 900,
    clientReading: false,
  }
}

/**
 * Если текущая реплика off-topic — увеличиваем счётчик (streak).
 * При >= 3 → TERMINATED_OFFTOPIC.
 * При 1–2 → null + nextCount (движок отвечает clarify/nonsense, UI патчит счётчик).
 * On-topic → nextCount = 0.
 */
export function resolveOffTopicGuard(input: {
  userText: string
  clientId: string
  dialogueState?: DialogueContext | DialogueSnapshot | null
  scriptStep?: number
}): { result: SmartReplyResult | null; offTopicCount: number } {
  const prev =
    (input.dialogueState as DialogueContext | null)?.slots?.offTopicCount ?? 0

  if (!isOffTopicMessage(input.userText)) {
    return { result: null, offTopicCount: 0 }
  }

  const offTopicCount = prev + 1
  if (offTopicCount >= 3) {
    return {
      result: buildOffTopicTerminationResult({
        clientId: input.clientId,
        dialogueState: input.dialogueState,
        scriptStep: input.scriptStep,
        offTopicCount,
      }),
      offTopicCount,
    }
  }

  return { result: null, offTopicCount }
}

/**
 * Глобальный пайплайн до логики персонажа.
 * Одинаков для Марины, Артёма и любой будущей персоны
 * (`clientId` влияет только на род в warning-тексте, не на пороги бана).
 *
 * ```
 * Сообщение менеджера
 *         │
 *         ▼
 * [ 1. Мат / этика ] ──(2 нарушения)──> TERMINATED_ETIQUETTE  (бан для всех)
 *         │ OK
 *         ▼
 * [ 2. Оффтоп / флуд ] ──(3 подряд)──> TERMINATED_OFFTOPIC   (сброс для всех)
 *         │ OK
 *         ▼
 * [ 3. pass → логика текущего персонажа ]
 * ```
 */
export type GlobalGuardOutcome =
  | { kind: 'block'; result: SmartReplyResult }
  | { kind: 'pass'; offTopicCount: number }

export function resolveGlobalSessionGuards(input: {
  userText: string
  clientId: string
  historyMessages: { role: string; text: string }[]
  dialogueState?: DialogueContext | DialogueSnapshot | null
  scriptStep?: number
}): GlobalGuardOutcome {
  // 1. Этика — до любой persona/script логики
  const abuse = resolveAbuseGuard(input)
  if (abuse) {
    return { kind: 'block', result: abuse }
  }

  // 2. Оффтоп — тоже глобально, без ветвления по clientId
  const { result: offtopic, offTopicCount } = resolveOffTopicGuard(input)
  if (offtopic) {
    return { kind: 'block', result: offtopic }
  }

  // 3. Пропуск в FSM / beats персоны
  return { kind: 'pass', offTopicCount }
}
