import type { ClientMood } from './machine'

const COLD_PREFIXES = [
  'Говорите по существу. ',
  'У меня мало времени. ',
  'Коротко, пожалуйста. ',
]

const WARM_PREFIXES = [
  'Да, это звучит логично. ',
  'Интересно, продолжайте. ',
  'Хорошо, слушаю. ',
]

function firstTwoSentences(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return t
  const parts = t.match(/[^.!?…]+[.!?…]?/g)
  if (!parts || parts.length === 0) return t
  if (parts.length === 1) return parts[0]!.trim()
  // Холодный тон: максимум 2 предложения, не одно — иначе убиваем смысл
  return `${parts[0]!.trim()} ${parts[1]!.trim()}`.trim()
}

/**
 * Модификатор тона.
 * Важно: НЕ превращать ответ в один обрубок «У меня мало времени» —
 * сохраняем смысл реплики.
 */
export function applyToneModifier(
  reply: string,
  mood: ClientMood,
  opts: { allowPrefix?: boolean } = {},
): { text: string; tone: 'cold' | 'warm' | 'neutral' } {
  const allowPrefix = opts.allowPrefix !== false
  const base = reply.trim()
  if (!base) return { text: base, tone: 'neutral' }

  if (mood.irritation >= 7) {
    let body = firstTwoSentences(base)
    // Если после обрезки остался только префикс/крючок — вернуть исходник укороченный иначе
    if (body.length < 40 && base.length > body.length) {
      body = base.slice(0, 180).trim()
      if (base.length > 180) body = `${body}…`
    }
    if (!allowPrefix || /по существу|мало времени|коротко, пожалуйста/i.test(body)) {
      return { text: body, tone: 'cold' }
    }
    // Префикс не чаще и не вместо ответа
    const prefix = COLD_PREFIXES[Math.floor(Math.random() * COLD_PREFIXES.length)]!
    return { text: `${prefix}${body}`, tone: 'cold' }
  }

  if (mood.trust >= 7) {
    if (!allowPrefix || /звучит логично|интересно|слушаю/i.test(base)) {
      return { text: base, tone: 'warm' }
    }
    const prefix = WARM_PREFIXES[Math.floor(Math.random() * WARM_PREFIXES.length)]!
    return { text: `${prefix}${base}`, tone: 'warm' }
  }

  return { text: base, tone: 'neutral' }
}
