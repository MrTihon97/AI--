/**
 * Типы возражений персоны — антиповтор в одной сессии.
 */

export type ObjectionType =
  | 'PATIENT_IN_CHAIR'
  | 'NO_TIME'
  | 'GIVE_ESSENCE'
  | 'PRICE_FIGURE'
  | 'SKEPTIC_OK'
  | 'GENERIC_BUSY'
  | 'LEGACY_CRM'
  | 'REPLACEMENT_PUSHBACK'
  | 'INTEGRATION_ROI'

const TYPE_PATTERNS: { type: ObjectionType; re: RegExp }[] = [
  {
    type: 'PATIENT_IN_CHAIR',
    re: /пациент\s+в\s+кресл|при[её]м\s+через|у\s+меня\s+пациент/i,
  },
  {
    type: 'NO_TIME',
    re: /некогда|времени\s+мало|через\s+минуту\s+пациент|15\s*секунд|за\s+15\s*секунд/i,
  },
  {
    type: 'GIVE_ESSENCE',
    re: /в\s+ч[её]м\s+суть|сначала\s+суть|тезис\s+одним|без\s+презентац|зачем\s+звоните|суть\s+звонка/i,
  },
  {
    type: 'PRICE_FIGURE',
    re: /откуда\s+(цифра|сумм)|названной\s+сумм|50.?100|тысяч\?/i,
  },
  {
    type: 'SKEPTIC_OK',
    re: /все\s+успевают|потери\s+на\s+глаз|зачем\s+нам\s+ещ[её]/i,
  },
  {
    type: 'GENERIC_BUSY',
    re: /подождите\s+с\s+zoom|какой\s+zoom|не\s+до\s+демо/i,
  },
  {
    type: 'REPLACEMENT_PUSHBACK',
    re: /снест\w*\s+(?:1\s*[cс]|1с|мис)|замен\w*\s+(?:мис|1\s*[cс]|1с)|риск\s+(?:баз|потер)|стоп-фактор|полная\s+замена\s+мис/i,
  },
  {
    type: 'INTEGRATION_ROI',
    re: /модул\w*\s+(?:поверх|в\s+связке)|интеграц\w*.{0,40}цифр|окупаем\w*\s+модул/i,
  },
  {
    type: 'LEGACY_CRM',
    re: /уже\s+(?:есть|стоит)\s+(?:1\s*[cс]|1с|инфодент|meddesk)|на\s+инфодент|рабочая\s+мис|менять\s+мис/i,
  },
]

export function classifyObjectionType(text: string): ObjectionType | null {
  if (!text?.trim()) return null
  for (const { type, re } of TYPE_PATTERNS) {
    if (re.test(text)) return type
  }
  return null
}

export function mergeUsedObjections(
  prev: string[] | undefined,
  replyText: string,
): string[] {
  const t = classifyObjectionType(replyText)
  if (!t) return [...(prev ?? [])]
  const set = new Set([...(prev ?? []), t])
  return [...set].slice(-12)
}

export function objectionTypeUsed(
  type: ObjectionType | null | undefined,
  used: string[] | undefined,
): boolean {
  if (!type || !used || used.length === 0) return false
  return used.includes(type)
}

/** Фразы «сначала суть / в чём суть» — после отработки GIVE_ESSENCE запрещены. */
export const ESSENCE_LOOP_RE =
  /в\s+ч[её]м\s+суть|сначала\s+суть|тезис\s+одним|суть\s+звонка|без\s+презентац/i

export function filterUnusedObjectionLines(
  pool: string[],
  used: string[] | undefined,
): string[] {
  if (!used || used.length === 0) return pool
  const fresh = pool.filter((line) => {
    const t = classifyObjectionType(line)
    if (!t) return true
    return !used.includes(t)
  })
  return fresh.length > 0 ? fresh : pool.filter((l) => !ESSENCE_LOOP_RE.test(l))
}
