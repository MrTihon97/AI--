/**
 * Ключи раскрытых болей персоны — антиповтор «Ирина вручную…» в одной сессии.
 */

export type PainFactKey =
  | 'irina_manual'
  | 'whatsapp_hang'
  | 'journal_paper'
  | 'no_shows'
  | 'conversion_blind'
  | 'admin_overload'
  | 'losses_generic'
  | 'excel_chaos'

const KEY_PATTERNS: { key: PainFactKey; re: RegExp }[] = [
  {
    key: 'irina_manual',
    re: /ирина.*(вручн|whatsapp|забыв|не\s+перезвон|пишет)|вручную\s+пишет\s+в\s+whatsapp|ирина\s+вс[её]\s+вручную/i,
  },
  {
    key: 'whatsapp_hang',
    re: /(вечером\s+чат|чат(ы)?\s+висят|висит\s+до\s+вечер|открываем\s+только\s+утром|заявки\s+висят|из\s+мессенджера\s+часть)/i,
  },
  {
    key: 'journal_paper',
    re: /(бумажн\w*\s+журнал|журнал\s+бумаж|учёт\s+в\s+журнале|вед[её]м\s+руками\s+[—–-]\s+журнал)/i,
  },
  {
    key: 'excel_chaos',
    re: /(куск\w*\s+в\s+excel|excel\s+тоже|кто\s+в\s+excel)/i,
  },
  {
    key: 'no_shows',
    re: /(пустые\s+окна|неявк|на\s+гигиену\s+сами)/i,
  },
  {
    key: 'conversion_blind',
    re: /(сводного\s+отч[её]т|единой\s+картины\s+по\s+конверси|конверсию\s+по\s+точкам|считаем\s+на\s+глаз)/i,
  },
  {
    key: 'admin_overload',
    re: /(администратор\s+(тонет|тянет|сливает)|один\s+администратор\s+на\s+вс[её]|ирина\s+с\s+компьютером)/i,
  },
  {
    key: 'losses_generic',
    re: /(заявки\s+иногда\s+сгорают|цифры\s+потер|потери\s+есть,\s+но\s+в\s+деньгах|стыдно,\s*но\s+так\s+жив)/i,
  },
]

export function extractPainKeys(text: string): PainFactKey[] {
  if (!text?.trim()) return []
  const out: PainFactKey[] = []
  for (const { key, re } of KEY_PATTERNS) {
    if (re.test(text)) out.push(key)
  }
  return out
}

export function mergePainKeys(
  prev: string[] | undefined,
  text: string,
): PainFactKey[] {
  const next = extractPainKeys(text)
  const set = new Set<string>([...(prev ?? []), ...next])
  return [...set].slice(-24) as PainFactKey[]
}

/** Факт уже раскрыт — не повторять (любой пересекающийся ключ). */
export function isPainFactUsed(
  fact: string,
  usedKeys: string[] | undefined,
): boolean {
  if (!usedKeys || usedKeys.length === 0) return false
  const keys = extractPainKeys(fact)
  if (keys.length === 0) return false
  return keys.some((k) => usedKeys.includes(k))
}

/**
 * Оставить факты с новыми ключами; если все заняты — факты без pain-ключей
 * или любой не использованный дословно.
 */
export function filterUnusedPainFacts(
  pool: string[],
  usedKeys: string[] | undefined,
  usedReplies: string[] = [],
): string[] {
  const freshExact = pool.filter((p) => !usedReplies.includes(p))
  const base = freshExact.length > 0 ? freshExact : pool
  if (!usedKeys || usedKeys.length === 0) return base

  const novel = base.filter((p) => !isPainFactUsed(p, usedKeys))
  if (novel.length > 0) return novel

  // Все pain-ключи уже были — только нейтральные / без ключей
  const neutral = base.filter((p) => extractPainKeys(p).length === 0)
  return neutral.length > 0 ? neutral : base
}
