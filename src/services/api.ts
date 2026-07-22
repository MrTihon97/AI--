import rawData from '../data/mock-data.json'
import type {
  ClientSession,
  DashboardData,
  DialogueHistory,
  FeedbackResult,
  FeedbackSession,
  ManagerProfile,
  MockData,
  RoleplayHistoryItem,
  RoleplaySavePayload,
  SmartReplyResult,
} from '../types'
import { routeSmartReply } from '../utils/intentRouter'
import { buildDynamicFeedback, type IntentLogItem } from '../utils/feedbackScore'
import { todayIso, yesterdayIso } from '../utils/zones'

const STORAGE_KEY = 'ai-trenazher-state-v2'
const NETWORK_DELAY_MS = 300

type PersistedState = {
  manager: ManagerProfile
  history: RoleplayHistoryItem[]
}

function delay(ms = NETWORK_DELAY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cloneData(): MockData {
  return structuredClone(rawData as MockData)
}

function loadState(): PersistedState {
  const base = cloneData()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { manager: base.manager, history: base.history }
    }
    const parsed = JSON.parse(raw) as PersistedState
    return {
      manager: parsed.manager ?? base.manager,
      history: parsed.history ?? base.history,
    }
  } catch {
    return { manager: base.manager, history: base.history }
  }
}

function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function getDb(): MockData {
  const base = cloneData()
  const persisted = loadState()
  return {
    ...base,
    manager: persisted.manager,
    history: persisted.history,
  }
}

/** Дашборд: профиль, этапы, план, история, список клиентов. */
export async function getDashboardData(): Promise<DashboardData> {
  await delay(300)
  const db = getDb()
  return {
    product: db.product,
    manager: db.manager,
    history: [...db.history].sort((a, b) => b.date.localeCompare(a.date)),
    clients: db.clients,
  }
}

/** Карточка клиента и сценарий по id. */
export async function getClientById(id: string): Promise<ClientSession> {
  await delay(300)
  const client = getDb().clients.find((c) => c.id === id)
  if (!client) {
    throw new Error(`Клиент ${id} не найден`)
  }
  return structuredClone(client)
}

/**
 * Умный роутер ответа клиента.
 * Классифицирует реплику менеджера (greeting / price / discovery / objection / confused)
 * и отдаёт адекватную реплику из мока. На offtopic шаг диалога не двигается.
 *
 * При подключении LLM замените тело функции — UI менять не нужно.
 */
export async function getSmartReply(
  userText: string,
  history: DialogueHistory,
): Promise<SmartReplyResult> {
  await delay(300)
  const client = getDb().clients.find((c) => c.id === history.clientId)
  if (!client) {
    throw new Error(`Клиент ${history.clientId} не найден`)
  }

  const clientReplies = history.messages
    .filter((m) => m.role === 'client')
    .map((m) => m.text)

  return routeSmartReply(
    userText,
    history.scriptStep,
    client.scenario,
    clientReplies,
    history.clientId,
    history.messages,
  )
}

/** Шаблон разбора + динамический скоринг по интентам чата + реальные цитаты. */
export async function buildFeedbackSession(
  clientId: string,
  managerMessages: string[],
  intentLog: IntentLogItem[] = [],
): Promise<FeedbackSession> {
  await delay(300)
  const client = await getClientById(clientId)
  const { feedback, insights } = buildDynamicFeedback(
    client.feedback,
    intentLog,
    managerMessages,
  )

  return {
    clientId: client.id,
    clientName: client.name,
    managerMessages,
    feedback,
    insights,
    intentLog,
  }
}

/**
 * Сохраняет результат ролёвки: новая запись в истории, стрик +1, обновление баллов.
 */
export async function saveRoleplayResult(
  result: RoleplaySavePayload,
): Promise<DashboardData> {
  await delay(300)
  const db = getDb()

  const newItem: RoleplayHistoryItem = {
    id: `h-${Date.now()}`,
    date: todayIso(),
    clientId: result.clientId,
    clientName: result.clientName,
    totalScore: result.totalScore,
    stageScores: result.stageScores,
    feedback: result.feedback,
    insights: result.insights,
    managerMessages: result.managerMessages,
  }

  const history = [newItem, ...db.history]

  const stages = db.manager.stages.map((stage) => {
    const fresh = result.stageScores[stage.id]
    if (fresh == null) return stage
    const score = Number((stage.score * 0.7 + fresh * 0.3).toFixed(1))
    return { ...stage, score }
  })

  let markedTask = false
  const dailyPlan = db.manager.dailyPlan.map((task) => {
    if (!markedTask && !task.done) {
      markedTask = true
      return { ...task, done: true }
    }
    return task
  })

  const sorted = [...db.history].sort((a, b) => b.date.localeCompare(a.date))
  const lastDate = sorted[0]?.date
  const today = todayIso()
  const yesterday = yesterdayIso()
  const streakDays =
    lastDate === today
      ? db.manager.streakDays
      : lastDate === yesterday
        ? db.manager.streakDays + 1
        : 1

  const manager: ManagerProfile = {
    ...db.manager,
    streakDays,
    stages,
    dailyPlan,
  }

  saveState({ manager, history })

  return {
    product: db.product,
    manager,
    history: [...history].sort((a, b) => b.date.localeCompare(a.date)),
    clients: db.clients,
  }
}

export async function listClients(): Promise<
  Array<{
    id: string
    name: string
    role: string
    segment: string
    mood: string
  }>
> {
  await delay(300)
  return getDb().clients.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    segment: c.segment,
    mood: c.mood,
  }))
}

/** Переключить задачу плана на сегодня (persist в localStorage). */
export async function toggleDailyTask(taskId: string): Promise<DashboardData> {
  await delay(200)
  const db = getDb()
  const manager: ManagerProfile = {
    ...db.manager,
    dailyPlan: db.manager.dailyPlan.map((task) =>
      task.id === taskId ? { ...task, done: !task.done } : task,
    ),
  }
  saveState({ manager, history: db.history })
  return {
    product: db.product,
    manager,
    history: [...db.history].sort((a, b) => b.date.localeCompare(a.date)),
    clients: db.clients,
  }
}

/** Открыть сохранённый разбор из истории (или собрать из шаблона клиента). */
export async function getHistoryFeedback(historyId: string): Promise<FeedbackSession> {
  await delay(250)
  const db = getDb()
  const item = db.history.find((h) => h.id === historyId)
  if (!item) throw new Error('Запись истории не найдена')

  if (item.feedback) {
    return {
      clientId: item.clientId,
      clientName: item.clientName,
      managerMessages: item.managerMessages ?? [],
      feedback: item.feedback,
      insights: item.insights,
    }
  }

  const client = db.clients.find((c) => c.id === item.clientId)
  const baseFeedback: FeedbackResult = client?.feedback ?? {
    totalScore: item.totalScore,
    stageScores: Object.entries(item.stageScores).map(([stageId, score]) => ({
      stageId,
      score,
      comment: 'Оценка из истории тренировки.',
    })),
    mistakes: [],
    recommendations: [
      'Повторите ролёвку и сохраните разбор — появится полный фидбек.',
    ],
  }

  return {
    clientId: item.clientId,
    clientName: item.clientName,
    managerMessages: item.managerMessages ?? [],
    feedback: {
      ...baseFeedback,
      totalScore: item.totalScore,
      stageScores: Object.entries(item.stageScores).map(([stageId, score]) => {
        const found = baseFeedback.stageScores.find((s) => s.stageId === stageId)
        return {
          stageId,
          score,
          comment: found?.comment ?? 'Оценка из истории тренировки.',
        }
      }),
    },
  }
}

export function resetProgress(): void {
  localStorage.removeItem(STORAGE_KEY)
}
