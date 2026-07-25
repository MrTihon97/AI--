/**
 * Четыре механики реализма диалога (без LLM):
 * 1. Emotion Inertia — плавное снижение irritation
 * 2. Active Listening — Ack с отсылкой к сущности
 * 3. Conversation Pacing — перебив монолога менеджера
 * 4. Beat Timing — задержка/статус «читает» по сложности бита
 */
import type { MentionedEntity } from '../dialogue/entities'
import type { Beat, BeatId } from '../dialogue/beats'
import { planBeat as planDialogueBeat } from '../dialogue/beats'
import type { DialogueContext } from '../dialogue/machine'
import type { NluIntentId } from '../dialogue/training'
import {
  coolIrritationWithInertia,
  heatIrritation,
  needsRestrainedAck,
  IRRITATION_COOL_CAP_WHEN_HIGH,
} from '../dialogue/emotionInertia'
import {
  managerAskedQuestion,
  nextMonoStreak,
} from '../dialogue/pacing'
import { offersDemoSlot } from '../dialogue/entities'
import {
  fillGender,
  voiceGenderForClient,
  type VoiceGender,
} from '../dialogue/gender'

export type BeatTiming = {
  delayMs: number
  reading: boolean
}

export type { VoiceGender }
export { voiceGenderForClient, fillGender }

export {
  coolIrritationWithInertia,
  heatIrritation,
  needsRestrainedAck,
  IRRITATION_COOL_CAP_WHEN_HIGH,
  managerAskedQuestion,
  nextMonoStreak,
}

const ENTITY_LABEL: Partial<Record<MentionedEntity, string>> = {
  crm: 'CRM',
  потери: 'потери',
  конверсия: 'конверсию',
  интеграция: 'интеграцию',
  whatsapp: 'WhatsApp',
  неявки: 'неявки',
  цена: 'цену',
  демо: 'демо',
  журнал: 'журнал',
  администратор: 'администратора',
  филиалы: 'филиалы',
}

const LISTENING_ENTITIES: MentionedEntity[] = [
  'crm',
  'конверсия',
  'потери',
  'интеграция',
  'whatsapp',
  'неявки',
  'цена',
]

/** Общие шаблоны с плейсхолдерами рода — fillGender на выдаче. */
const RESTRAINED_ACK_TEMPLATES = [
  'Хорошо, продолжайте...',
  'Сдержанно {принял}.',
  'Ок, слушаю дальше — по делу.',
]

const PACE_INTERRUPT_REPLIES = [
  'Подождите, вы мне сейчас рассказываете общие вещи. Задайте конкретный вопрос или назовите цифры.',
  'Стоп. Пока слышу общие тезисы. Задайте конкретный вопрос или озвучьте цифры.',
  'Минуту. Без общего рассказа — конкретный вопрос или цифры, иначе не сдвинемся.',
]

function listeningTemplates(_hit: MentionedEntity, _label: string): string[] {
  // Без мета-комментариев и без скептического «допустим»
  return [
    'Ок, слушаю.',
    'Угу.',
    'Хорошо, давайте по делу.',
    'Слушаю дальше.',
  ]
}

export function pickRestrainedAck(
  used: string[] = [],
  gender: VoiceGender = 'f',
): string {
  const filled = RESTRAINED_ACK_TEMPLATES.map((t) => fillGender(t, gender))
  const fresh = filled.filter((a) => !used.includes(a))
  const pool = fresh.length > 0 ? fresh : filled
  return pool[Math.floor(Math.random() * pool.length)]!
}

/** Active Listening: Ack с отсылкой к сущности + антиповтор + род персоны. */
export function buildActiveListeningAck(
  entities: MentionedEntity[],
  opts: {
    irritation: number
    used?: string[]
    fallbackAck?: string
    /** Если true — лучше вернуть fallback, чем снова клеить listening */
    preferSkip?: boolean
    gender?: VoiceGender
    clientId?: string
  },
): string {
  const gender =
    opts.gender ?? voiceGenderForClient(opts.clientId)

  if (needsRestrainedAck(opts.irritation)) {
    return pickRestrainedAck(opts.used, gender)
  }

  let hits = LISTENING_ENTITIES.filter((e) => entities.includes(e))
  // Конверсия ≠ «Про потери поняла»
  if (hits.includes('конверсия')) {
    hits = hits.filter((e) => e !== 'потери')
  }
  if (hits.length === 0) {
    return opts.fallbackAck?.trim() || ''
  }

  // Иногда пропускаем listening, если недавно уже был — меньше шаблонности
  if (opts.preferSkip && Math.random() < 0.55) {
    return opts.fallbackAck?.trim() || ''
  }

  const used = opts.used ?? []
  const candidates: string[] = []

  for (const hit of hits) {
    const label = ENTITY_LABEL[hit] ?? hit
    for (const tpl of listeningTemplates(hit, label)) {
      const v = fillGender(tpl, gender)
      if (!used.includes(v)) candidates.push(v)
    }
  }

  if (candidates.length === 0) {
    return opts.fallbackAck?.trim() || ''
  }

  return candidates[Math.floor(Math.random() * candidates.length)]!
}

export function shouldPaceInterrupt(
  ctx: DialogueContext,
  userText: string,
): boolean {
  const streak = nextMonoStreak(ctx.managerMonoStreak ?? 0, userText)
  return streak >= 2
}

export function paceInterruptReply(used: string[] = []): string {
  const fresh = PACE_INTERRUPT_REPLIES.filter((r) => !used.includes(r))
  const pool = fresh.length > 0 ? fresh : PACE_INTERRUPT_REPLIES
  return pool[Math.floor(Math.random() * pool.length)]!
}

export function paceInterruptBeat(): Beat {
  return {
    id: 'pace_interrupt',
    policyId: 'beat:pace_interrupt',
    template: 'single_pool',
    topic: 'generic',
    skipHook: true,
    skipTone: true,
    soft: true,
  }
}

/** Синхронизация задержек по сложности бита. */
export function timingForBeat(
  beat: Beat | null,
  opts: { isDeveloped?: boolean; isOpening?: boolean } = {},
): BeatTiming {
  if (opts.isOpening || beat?.id === 'intro_open' || beat?.id === 'intro_hello' || beat?.id === 'intro_frame' || beat?.id === 'contact_gate') {
    return { delayMs: 1000, reading: false }
  }

  const id = beat?.id
  if (
    id === 'line_ping' ||
    id === 'closing_confirm' ||
    id === 'closing_need_slot' ||
    id === 'clarify' ||
    id === 'busy'
  ) {
    return { delayMs: 1000, reading: false }
  }

  if (id === 'pace_interrupt' || id === 'nonsense' || id === 'aggression') {
    return { delayMs: 1200, reading: false }
  }

  const complex: BeatId[] = [
    'pitch',
    'objection',
    'price_discuss',
    'price_stated',
    'price_early',
    'legacy_crm',
    'legacy_crm_discovery',
    'legacy_replacement_error',
    'legacy_integration_ok',
  ]
  if (opts.isDeveloped || (id && complex.includes(id))) {
    const delayMs = 2500 + Math.floor(Math.random() * 501)
    return { delayMs, reading: true }
  }

  if (id === 'discovery_pain' || id === 'closing_ok' || id === 'closing_early') {
    return { delayMs: 1600, reading: false }
  }

  if (
    id === 'persona_pushback' ||
    id === 'objection_busy' ||
    id === 'objection_skepticism' ||
    id === 'legacy_crm' ||
    id === 'legacy_crm_discovery' ||
    id === 'legacy_replacement_error' ||
    id === 'legacy_integration_ok'
  ) {
    return { delayMs: 1400, reading: false }
  }

  return { delayMs: 1400, reading: false }
}

/** Планировщик с pacing-перебивом поверх dialogue/beats. */
export function planBeatWithMechanics(input: {
  intentId: NluIntentId
  ctx: DialogueContext
  userText: string
  isNonsense: boolean
  isDeveloped: boolean
  isOpening?: boolean
}): Beat | null {
  if (
    !input.isOpening &&
    !input.isNonsense &&
    input.intentId !== 'aggression' &&
    input.intentId !== 'greeting' &&
    input.intentId !== 'closing' &&
    !offersDemoSlot(input.userText) &&
    shouldPaceInterrupt(input.ctx, input.userText)
  ) {
    return paceInterruptBeat()
  }

  return planDialogueBeat(input)
}

export {
  planBeat,
  type Beat,
  type BeatId,
  type BeatTemplate,
} from '../dialogue/beats'
