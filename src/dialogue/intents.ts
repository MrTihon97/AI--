/**
 * NLU-паттерны домена: сторонняя МИС/CRM и стратегия ответа менеджера.
 * Детерминированные regex — без LLM.
 */

const NORM = (t: string) => t.toLowerCase().replace(/ё/g, 'е')

/** Уже стоящая МИС/CRM клиники (1С, Инфодент, MedDesk…). */
export const LEGACY_CRM_RE =
  /(?:1\s*[cс]|1с|один\s*эс)|инфодент|infodent|meddesk|меддеск|икастом|ikastom|клиника\s*365|clinic\s*365|медодс|medods|битрикс(?:24)?|amocrm|амо\s*срм|dent\s*expert|иденти\s*ка|дентист\s*менеджер|стомат\w*\s*1\s*[cс]/i

/** Попытка «снести» рабочую МИС и заменить на ДентаCRM. */
export const FULL_REPLACEMENT_PITCH_RE =
  /(?:замен\w*|перейд\w*|переезд\w*|миграц\w*|снест\w*|выруб\w*|убер\w*|откаж\w*\s+от|вместо\s+ваш|вместо\s+(?:1\s*[cс]|1с|инфодент|meddesk)|больше\s+не\s+нужн\w*\s+(?:1\s*[cс]|1с|инфодент)|выкин\w*\s+(?:1\s*[cс]|1с)|перевед\w*\s+(?:вс[её]|вас)\s+на\s+(?:дента|наш|crm))/i

/** Позиционирование как модуля / интеграции поверх текущей МИС. */
export const INTEGRATION_PITCH_RE =
  /(?:интеграц\w*|поверх\s+(?:1\s*[cс]|1с|инфодент|meddesk|вашей\s+мис|вашей\s+crm)|в\s+связке.{0,28}(?:с\s+)?(?:1\s*[cс]|1с|инфодент|meddesk|мис|ваш)|рядом\s+с\s+(?:1\s*[cс]|1с)|дополн\w*\s+(?:к|ваш)|модул\w*.{0,40}(?:1\s*[cс]|1с|инфодент|мис)|не\s+меня\w*\s+(?:1\s*[cс]|1с|мис|систем)|не\s+трога\w*\s+(?:1\s*[cс]|1с|баз)|работа\w*\s+вместе\s+с\s+(?:1\s*[cс]|1с)|подключа\w*.{0,32}(?:к\s+)?(?:1\s*[cс]|1с|инфодент))/i

export type LegacyCrmSignal =
  | 'legacy_crm'
  | 'full_replacement_pitch'
  | 'integration_pitch'

export function mentionsLegacyCrm(text: string): boolean {
  if (!text?.trim()) return false
  return LEGACY_CRM_RE.test(NORM(text))
}

export function isFullReplacementPitch(text: string): boolean {
  if (!text?.trim()) return false
  const t = NORM(text)
  // «миграция с 1С» в вопросе клиента/сравнении ≠ наш питч замены
  if (!FULL_REPLACEMENT_PITCH_RE.test(t)) return false
  // Интеграция побеждает замену, если оба маркера
  if (INTEGRATION_PITCH_RE.test(t) && !/замен\w*|вместо\s+ваш|снест/i.test(t)) {
    return false
  }
  return true
}

export function isIntegrationPitch(text: string): boolean {
  if (!text?.trim()) return false
  const t = NORM(text)
  if (isFullReplacementPitch(text)) return false
  return INTEGRATION_PITCH_RE.test(t)
}

/** Приоритет: replacement → integration → legacy mention. */
export function detectLegacyCrmSignal(text: string): LegacyCrmSignal | null {
  if (!text?.trim()) return null
  if (isFullReplacementPitch(text)) return 'full_replacement_pitch'
  if (isIntegrationPitch(text)) return 'integration_pitch'
  if (mentionsLegacyCrm(text)) return 'legacy_crm'
  return null
}
