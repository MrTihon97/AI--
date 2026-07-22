export type Zone = 'red' | 'yellow' | 'green'

export type Intent =
  | 'greeting'
  | 'price'
  | 'discovery'
  | 'objection'
  | 'close'
  | 'confused'
  | 'unknown'

export interface Product {
  name: string
  pitch: string
  price: string
}

/** Прогресс по одному из 5 этапов продаж (балл 1–10). Зоны: red <5, yellow 5–7, green >7 */
export interface StageProgress {
  id: string
  name: string
  score: number
}

export interface DailyTask {
  id: string
  title: string
  done: boolean
}

export interface ManagerProfile {
  name: string
  level: string
  streakDays: number
  stages: StageProgress[]
  dailyPlan: DailyTask[]
}

export interface RoleplayHistoryItem {
  id: string
  date: string
  clientId: string
  clientName: string
  totalScore: number
  stageScores: Record<string, number>
  /** Сохранённый разбор — чтобы открыть из истории */
  feedback?: FeedbackResult
  insights?: Array<{ id: string; label: string; deltaTotal: number }>
  managerMessages?: string[]
}

export interface ScenarioIntentReplies {
  greeting: string
  price: string
  discovery: string
  objection: string
  confused: string
  close: string
}

export interface Scenario {
  id: string
  /** Линейный сценарий — fallback, если интент не распознан */
  clientReplies: string[]
  intentReplies: ScenarioIntentReplies
  fallbackReply: string
}

export interface FeedbackStageScore {
  stageId: string
  score: number
  comment: string
}

export interface FeedbackMistake {
  stageId: string
  managerQuote: string
  comment: string
}

export interface FeedbackResult {
  totalScore: number
  stageScores: FeedbackStageScore[]
  mistakes: FeedbackMistake[]
  recommendations: string[]
}

/** Клиент + сценарий диалога + шаблон разбора */
export interface ClientSession {
  id: string
  name: string
  role: string
  segment: string
  portrait: string
  pains: string[]
  goals: string[]
  mood: string
  scenario: Scenario
  feedback: FeedbackResult
}

export interface ChatMessage {
  id: string
  role: 'manager' | 'client'
  text: string
  ts: number
}

/** Контекст диалога для Smart Mock Router */
export interface DialogueHistory {
  clientId: string
  scriptStep: number
  messages: ChatMessage[]
}

export interface SmartReplyResult {
  reply: string
  nextStep: number
  intent: Intent
  /** id из dialogue-bank (greeting, price_objection, …) */
  intentId?: string
}

export interface DashboardData {
  product: Product
  manager: ManagerProfile
  history: RoleplayHistoryItem[]
  clients: ClientSession[]
}

export interface RoleplaySavePayload {
  clientId: string
  clientName: string
  totalScore: number
  stageScores: Record<string, number>
  managerMessages: string[]
  feedback?: FeedbackResult
  insights?: Array<{ id: string; label: string; deltaTotal: number }>
}

/** Сессия разбора, передаётся на экран Feedback */
export interface FeedbackSession {
  clientId: string
  clientName: string
  managerMessages: string[]
  feedback: FeedbackResult
  /** Почему балл сдвинулся относительно шаблона */
  insights?: Array<{ id: string; label: string; deltaTotal: number }>
  intentLog?: Array<{ intentId: string; managerQuote: string }>
}

export interface MockData {
  product: Product
  manager: ManagerProfile
  history: RoleplayHistoryItem[]
  clients: ClientSession[]
}
