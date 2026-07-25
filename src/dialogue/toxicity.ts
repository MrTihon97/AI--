/**
 * Toxicity / abuse: 2-step warning → TERMINATED_ETIQUETTE.
 * Детекция — общий abuseDetect (все персоны).
 */
import { containsAbuseOrProfanity } from '../utils/abuseDetect'
import { fillGender, voiceGenderForClient } from './gender'

export type SessionStatus =
  | 'active'
  | 'warning'
  | 'failed'
  | 'completed'
  | 'terminated_etiquette'
  | 'terminated_offtopic'

export type FailReason =
  | 'toxicity_limit_exceeded'
  | 'terminated_etiquette'
  | 'terminated_offtopic'
  | null

export {
  containsAbuseOrProfanity as isToxicMessage,
  containsAbuseOrProfanity as isAggression,
  containsAbuseOrProfanity,
}

/** 1-е нарушение — предупреждение, диалог продолжается */
export function toxicityWarningReply(clientId?: string): string {
  return fillGender(
    'Давайте держать рамки делового общения. Я здесь для обсуждения задач клиники. Если продолжится хамство — {вынужден} буду завершить разговор.',
    voiceGenderForClient(clientId),
  )
}

/** 2-е нарушение — бан */
export function toxicityTerminateReply(): string {
  return 'Вы адекватны? Я завершаю этот разговор.'
}

export function isEtiquetteTerminated(
  status?: string | null,
  failReason?: string | null,
): boolean {
  return (
    status === 'terminated_etiquette' ||
    status === 'failed' ||
    failReason === 'terminated_etiquette' ||
    failReason === 'toxicity_limit_exceeded'
  )
}

/** Сессия закрыта (этика / off-topic / failed) — ввод и FSM стоп. */
export function isSessionLocked(
  status?: string | null,
  failReason?: string | null,
): boolean {
  return (
    isEtiquetteTerminated(status, failReason) ||
    status === 'terminated_offtopic' ||
    failReason === 'terminated_offtopic'
  )
}
