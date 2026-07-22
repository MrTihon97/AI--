import { delay } from './zones'

/** Задержка «печатает…» пропорционально длине ответа. */
export function typingDelayFor(text: string): number {
  return Math.min(2600, Math.max(1100, 700 + text.length * 22))
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
