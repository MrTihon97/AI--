/**
 * Shared abuse / profanity detection for dialogue FSM + report evaluator.
 * Keep one detector — иначе движок и отчёт расходятся.
 *
 * Важно: JS `\b` / `\w` не работают с кириллицей (\\w = [A-Za-z0-9_]).
 * Используем границы и «буквы» на латинице+кириллице явно.
 */

function normalizeAbuse(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Граница «не буква/цифра» или край строки */
const B = '(?:^|[^a-zа-я0-9])'
const E = '(?:$|[^a-zа-я0-9])'
/** Продолжение слова (кириллица + латиница) — НЕ JS \\w */
const W = '[a-zа-я0-9]*'

/**
 * Корни ТЗ + типовые оскорбления.
 * Эквивалент: /хуй|пизд|еб|бл[яе]|сук|залуп|долб|пидор|пидар|гандон|гнид|урод|твар|дур|дебил|идиот/i
 * с границами токена (без ложных «хлеб» / «сутки»).
 */
export const PROFANITY_ROOTS_REGEX = new RegExp(
  `${B}(?:` +
    [
      `ху[йиеяj]${W}`,
      `пизд${W}`,
      `еб(?:ал|ать|ну|ен|лан|лок|ть|а|у|ы|о)${W}`,
      `бл[яе]${W}`,
      `сук[аиеу]${W}`,
      `залуп${W}`,
      `долб(?:о|а)${W}`,
      `пидор${W}`,
      `пидар${W}`,
      `гандон${W}`,
      `гнид${W}`,
      `урод${W}`,
      `твар${W}`,
      `дур(?:а|ак|очк${W}|ень)`,
      `дебил${W}`,
      `идиот${W}`,
      `мудак${W}`,
      `мразь?`,
    ].join('|') +
    `)${E}`,
  'i',
)

/**
 * Доп. грубые отшивы / англ. мат.
 */
export const ABUSE_REGEX = new RegExp(
  `${B}(?:` +
    [
      `кретин${W}`,
      `даун${W}`,
      'тупой',
      'тупая',
      'чмо',
      'козел',
      `скотин${W}`,
      `охуе${W}`,
      `ахуе${W}`,
      'нахуй',
      'нахер',
      `в\\s+жоп${W}`,
      'жоп[ауеы]',
      `пош[ео]л\\s+(?:на|в)${W}`,
      'заткни(?:сь)?',
      'отстань',
      'достал(?:а|и)?',
      'не\\s+звони',
      `какого\\s+черт${W}`,
      'fuck(?:ing)?',
      'shit',
    ].join('|') +
    `)${E}`,
  'i',
)

/**
 * Строгий детектор: корни ТЗ + расширенный abuse-список.
 * Работает для ЛЮБОЙ персоны (Марина, Артём, …).
 */
export function containsAbuseOrProfanity(text: string): boolean {
  if (!text?.trim()) return false
  const t = ` ${normalizeAbuse(text)} `
  return PROFANITY_ROOTS_REGEX.test(t) || ABUSE_REGEX.test(t)
}

/** Alias — единая точка для FSM / report / API */
export function containsAbuse(text: string): boolean {
  return containsAbuseOrProfanity(text)
}

/** Alias for dialogue / intent layers */
export const isToxicMessage = containsAbuseOrProfanity
