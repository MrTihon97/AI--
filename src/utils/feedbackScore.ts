import type { FeedbackMistake, FeedbackResult, FeedbackStageScore } from '../types'

export type IntentLogItem = {
  intentId: string
  managerQuote: string
}

export type ScoreInsight = {
  id: string
  label: string
  deltaTotal: number
}

const STAGE_IDS = [
  'contact',
  'discovery',
  'presentation',
  'objections',
  'closing',
] as const

function clamp(n: number, min = 1, max = 10): number {
  return Math.min(max, Math.max(min, n))
}

function avg(nums: number[]): number {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function findFirstIndex(log: IntentLogItem[], ids: string[]): number {
  return log.findIndex((i) => ids.includes(i.intentId))
}

function count(log: IntentLogItem[], ids: string[]): number {
  return log.filter((i) => ids.includes(i.intentId)).length
}

function quoteFor(
  log: IntentLogItem[],
  ids: string[],
  fallback: string,
): string {
  const hit = log.find((i) => ids.includes(i.intentId))
  return hit?.managerQuote?.trim() || fallback
}

/**
 * Динамический разбор: базовый шаблон клиента + дельты по интентам чата.
 */
export function buildDynamicFeedback(
  base: FeedbackResult,
  intentLog: IntentLogItem[],
  managerMessages: string[],
): { feedback: FeedbackResult; insights: ScoreInsight[] } {
  const scores = new Map(
    base.stageScores.map((s) => [s.stageId, { ...s } satisfies FeedbackStageScore]),
  )
  const insights: ScoreInsight[] = []
  const extraMistakes: FeedbackMistake[] = []

  const apply = (stageId: string, delta: number, commentExtra?: string) => {
    const row = scores.get(stageId)
    if (!row) return
    row.score = Number(clamp(row.score + delta).toFixed(1))
    if (commentExtra) {
      row.comment = `${row.comment} ${commentExtra}`
    }
  }

  const priceIds = ['price_inquiry', 'price_objection']
  const discoveryIds = ['need_discovery', 'value_challenge']
  const closingIds = ['closing']
  const offtopicIds = ['offtopic_confused', 'aggression_pushback', 'smalltalk_redirect']
  const pitchIds = ['product_pitch_response']
  const competitorIds = ['trust_competitors']
  const doubtIds = ['doubt_skepticism', 'authority_gate']

  const firstPrice = findFirstIndex(intentLog, priceIds)
  const firstDiscovery = findFirstIndex(intentLog, discoveryIds)
  const firstClosing = findFirstIndex(intentLog, closingIds)
  const firstPitch = findFirstIndex(intentLog, pitchIds)

  // Цена до выявления потребностей
  if (firstPrice !== -1 && (firstDiscovery === -1 || firstPrice < firstDiscovery)) {
    apply(STAGE_IDS[1], -2, 'Цена прозвучала до потребностей.')
    apply(STAGE_IDS[3], -1)
    insights.push({
      id: 'price_before_discovery',
      label: 'Цена до выявления потребностей (−2 discovery, −1 objections)',
      deltaTotal: -0.6,
    })
    extraMistakes.push({
      stageId: 'discovery',
      managerQuote: quoteFor(
        intentLog,
        priceIds,
        managerMessages[0] ?? 'Сразу про стоимость…',
      ),
      comment:
        'Вы назвали/спросили цену до болей клиента. Сначала 2–3 вопроса о ситуации, потом цифры.',
    })
  }

  // Питч до discovery
  if (firstPitch !== -1 && (firstDiscovery === -1 || firstPitch < firstDiscovery)) {
    apply(STAGE_IDS[2], -1.5, 'Презентация раньше потребностей.')
    insights.push({
      id: 'pitch_before_discovery',
      label: 'Презентация до discovery (−1.5 presentation)',
      deltaTotal: -0.3,
    })
    extraMistakes.push({
      stageId: 'presentation',
      managerQuote: quoteFor(intentLog, pitchIds, managerMessages[0] ?? '…'),
      comment:
        'Функции без привязки к боли. Сначала зафиксируйте проблему, потом модули.',
    })
  }

  // Хороший discovery
  const discoveryCount = count(intentLog, discoveryIds)
  if (discoveryCount >= 2) {
    apply(STAGE_IDS[1], 1.5, 'Несколько сильных вопросов о ситуации.')
    insights.push({
      id: 'strong_discovery',
      label: 'Сильное выявление потребностей (+1.5 discovery)',
      deltaTotal: 0.3,
    })
  } else if (discoveryCount === 1) {
    apply(STAGE_IDS[1], 0.5)
    insights.push({
      id: 'some_discovery',
      label: 'Был заход в потребности (+0.5 discovery)',
      deltaTotal: 0.1,
    })
  } else if (intentLog.length > 0) {
    apply(STAGE_IDS[1], -1, 'Почти не было вопросов о болях.')
    insights.push({
      id: 'no_discovery',
      label: 'Нет discovery-вопросов (−1 discovery)',
      deltaTotal: -0.2,
    })
  }

  // Закрытие
  if (firstClosing !== -1) {
    apply(STAGE_IDS[4], 1.5, 'Зафиксирован следующий шаг.')
    insights.push({
      id: 'has_closing',
      label: 'Есть попытка закрытия / демо (+1.5 closing)',
      deltaTotal: 0.3,
    })
  } else if (count(intentLog, doubtIds) > 0) {
    apply(STAGE_IDS[4], -1.5, 'Клиент ушёл в «подумаю» без слота.')
    insights.push({
      id: 'doubt_no_close',
      label: 'Скепсис без закрытия (−1.5 closing)',
      deltaTotal: -0.3,
    })
    extraMistakes.push({
      stageId: 'closing',
      managerQuote: quoteFor(intentLog, doubtIds, managerMessages.at(-1) ?? '…'),
      comment:
        'На «подумаю» нужен конкретный следующий шаг: демо, дата, WhatsApp с материалами.',
    })
  } else if (intentLog.length >= 2) {
    apply(STAGE_IDS[4], -1, 'Диалог без явного next step.')
    insights.push({
      id: 'no_closing',
      label: 'Нет закрытия (−1 closing)',
      deltaTotal: -0.2,
    })
  }

  // Offtopic / шум
  const offtopicCount = count(intentLog, offtopicIds)
  if (offtopicCount >= 3) {
    apply(STAGE_IDS[0], -2, 'Много неясных/коротких реплик.')
    insights.push({
      id: 'messy_contact',
      label: 'Много offtopic (−2 contact)',
      deltaTotal: -0.4,
    })
  } else if (offtopicCount >= 1) {
    apply(STAGE_IDS[0], -0.5)
  }

  if (count(intentLog, ['aggression_pushback']) > 0) {
    apply(STAGE_IDS[0], -2, 'Тон разговора просел.')
    insights.push({
      id: 'aggression',
      label: 'Жёсткий/срывной тон (−2 contact)',
      deltaTotal: -0.4,
    })
  }

  // Работа с конкурентами / возражениями
  if (count(intentLog, competitorIds) > 0) {
    // сам факт темы — нормально; если не было value/discovery рядом — штраф
    if (discoveryCount === 0) {
      apply(STAGE_IDS[3], -1, 'Конкуренты без опоры на ценность.')
      insights.push({
        id: 'competitors_no_value',
        label: 'Конкуренты без ценности (−1 objections)',
        deltaTotal: -0.2,
      })
    } else {
      apply(STAGE_IDS[3], 0.5, 'Тема конкурентов отработана на фоне болей.')
    }
  }

  if (count(intentLog, ['price_objection']) > 0 && discoveryCount > 0) {
    apply(STAGE_IDS[3], 0.5, 'Возражение по цене после контекста болей.')
  }

  // Контакт: было нормальное приветствие / длинные реплики
  const longReplies = managerMessages.filter((m) => m.trim().length >= 40).length
  if (longReplies >= 2) {
    apply(STAGE_IDS[0], 0.5, 'Развёрнутые реплики, диалог живой.')
  }

  const stageScores = STAGE_IDS.map((id) => {
    const row = scores.get(id)!
    return { ...row, score: Number(clamp(row.score).toFixed(1)) }
  })

  let totalScore = Number(avg(stageScores.map((s) => s.score)).toFixed(1))

  // Мало реплик менеджера — потолок
  if (managerMessages.length === 0) {
    totalScore = Number(clamp(totalScore - 1.5).toFixed(1))
    insights.push({
      id: 'empty_chat',
      label: 'Нет реплик менеджера (−1.5 к итогу)',
      deltaTotal: -1.5,
    })
  } else if (managerMessages.length === 1) {
    totalScore = Number(clamp(totalScore - 0.5).toFixed(1))
    insights.push({
      id: 'short_chat',
      label: 'Очень короткий диалог (−0.5 к итогу)',
      deltaTotal: -0.5,
    })
  }

  // Цитаты в базовых ошибках
  const baseMistakes = base.mistakes.map((mistake, index) => ({
    ...mistake,
    managerQuote:
      managerMessages[index]?.trim() ||
      managerMessages[managerMessages.length - 1]?.trim() ||
      mistake.managerQuote,
  }))

  // Рекомендации: приоритет по самым слабым этапам
  const weakest = [...stageScores].sort((a, b) => a.score - b.score).slice(0, 3)
  const stageNames: Record<string, string> = {
    contact: 'установлении контакта',
    discovery: 'выявлении потребностей',
    presentation: 'презентации',
    objections: 'работе с возражениями',
    closing: 'закрытии',
  }
  const dynamicRecs = weakest.map((s) => {
    if (s.stageId === 'discovery') {
      return 'Перед продуктом задайте минимум 3 вопроса о потерях заявок, администраторе и повторных визитах.'
    }
    if (s.stageId === 'objections') {
      return 'На «дорого» переводите в расчёт потерь клиники, а не в скидку.'
    }
    if (s.stageId === 'closing') {
      return 'Каждая ролёвка — с конкретным next step: демо, дата, канал.'
    }
    if (s.stageId === 'presentation') {
      return 'Говорите выгодами под боль клиента, не перечислением функций.'
    }
    return `Сфокусируйте следующую тренировку на этапе «${stageNames[s.stageId] ?? s.stageId}».`
  })

  const recommendations = [
    ...new Set([...dynamicRecs, ...base.recommendations]),
  ].slice(0, 3)

  // Ошибки: динамические первыми, потом шаблонные без дубля stage+quote
  const mistakes = [...extraMistakes, ...baseMistakes]
    .filter((m, idx, arr) => {
      const key = `${m.stageId}|${m.managerQuote}`
      return arr.findIndex((x) => `${x.stageId}|${x.managerQuote}` === key) === idx
    })
    .slice(0, 4)

  return {
    feedback: {
      totalScore,
      stageScores,
      mistakes,
      recommendations,
    },
    insights,
  }
}
