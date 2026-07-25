import { delay } from './zones'
import { isDevelopedArgument } from '../services/intentMatcher'

/**
 * Задержка «печатает…».
 * Предпочтительно использовать typingDelayMs с бэка (beat timing);
 * эта функция — fallback, если движок не вернул delay.
 */
export function typingDelayFor(
  replyText: string,
  userText = '',
  overrideMs?: number,
): number {
  if (typeof overrideMs === 'number' && overrideMs > 0) {
    return overrideMs
  }

  const base = Math.min(2600, Math.max(1000, 700 + replyText.length * 22))

  if (userText && isDevelopedArgument(userText)) {
    const reading = Math.min(
      3000,
      Math.max(2500, 1900 + userText.trim().length * 3),
    )
    return Math.max(base, reading)
  }

  return base
}

type StreamOpts = {
  aborted?: () => boolean
  /** пауза после каждого слова/пробела, мс */
  msPerChunk?: number
}

/**
 * Пословный стриминг — ощущение LLM без реального API.
 * Пробелы идут вместе со словами, чтобы не дёргать layout лишний раз.
 */
export async function streamByWords(
  fullText: string,
  onChunk: (partial: string) => void,
  opts: StreamOpts = {},
): Promise<void> {
  const chunks = fullText.match(/\S+\s*|\s+/g) ?? [fullText]
  let acc = ''
  const step = opts.msPerChunk ?? 26

  for (const chunk of chunks) {
    if (opts.aborted?.()) {
      onChunk(fullText)
      return
    }
    acc += chunk
    onChunk(acc)
    if (chunk.trim()) {
      await delay(step + Math.floor(Math.random() * 18))
    }
  }

  onChunk(fullText)
}
