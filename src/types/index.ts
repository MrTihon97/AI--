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
  /** Exact quote менеджера из чата */
  managerQuote: string
  /** Сухая критика (методология) */
  comment: string
  /** Как надо было сказать (нет для этики / хамства) */
  betterScript?: string
  /** Спец-карточка нарушения этики */
  tag?: 'etiquette_violation' | 'offtopic_violation'
}

export interface FeedbackSuccess {
  stageId: string
  managerQuote: string
  comment: string
  /** Спец-тег для визуального акцента (напр. развёрнутая аргументация клиенту) */
  tag?: 'strong_argument'
}

export interface FeedbackResult {
  totalScore: number
  stageScores: FeedbackStageScore[]
  mistakes: FeedbackMistake[]
  /** Успешные приёмы с цитатами */
  successes?: FeedbackSuccess[]
  recommendations: string[]
  /** Пройдено (>=7) / Требуется пересдача (<7) */
  verdict?: 'passed' | 'retake'
  verdictLabel?: string
  /** Главная жёсткая рекомендация */
  mainRecommendation?: string
  /** Провал из‑за токсичности / этики */
  failReason?:
    | 'toxicity_limit_exceeded'
    | 'terminated_etiquette'
    | 'terminated_offtopic'
    | null
  /** Глобальный флаг: диалог сорван хамством */
  etiquetteViolation?: boolean
  /** Провал: 3+ подряд off-topic без sales-контекста */
  offTopicViolation?: boolean
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
  /** Род голоса в репликах: m | f (плейсхолдеры {понял}/{поняла}) */
  gender?: 'm' | 'f'
  scenario: Scenario
  feedback: FeedbackResult
}

export interface ChatMessage {
  id: string
  role: 'manager' | 'client'
  text: string
  ts: number
  /**
   * FSM-этап в момент отправки (для менеджера).
   * Разбор цитирует по этому полю, а не по post-hoc regex.
   */
  stage?: string
  /** NLU / policy intent после ответа движка */
  intent?: string
}

/** Контекст диалога для Smart Mock Router */
export interface DialogueHistory {
  clientId: string
  scriptStep: number
  messages: ChatMessage[]
  /** Снимок FSM (XState-контекст) между ходами */
  dialogueState?: DialogueSnapshot | null
}

/** Сериализуемый снимок диалогового автомата */
export interface DialogueSnapshot {
  stage: string
  mood: { trust: number; interest: number; irritation: number }
  slots: {
    greeted: boolean
    contactEstablished?: boolean
    /** Синоним contactEstablished — представление обязательно до discovery */
    hasIntroduced?: boolean
    /** После «а вы кто?» — сдержанный следующий ответ */
    postGateReserved?: boolean
    painFound: boolean
    priceAskedEarly: boolean
    priceDiscussed: boolean
    pitched: boolean
    objectionHandled: boolean
    demoOffered: boolean
    developedArgument: boolean
    nonsenseStreak: number
    followUpAsked?: boolean
    /** Скепсис / тайм-прессинг персоны уже показан */
    personaPushbackShown?: boolean
    /**
     * Менеджер ответил на возражение — guard для AGREED / демо.
     * Ставится только после ответа на pushback, не в момент самого возражения.
     */
    hasHandledObjection?: boolean
    /** Сколько раз менеджер предлагал демо / слот */
    closingAttempts?: number
    /** Подряд идущие off-topic / невалидные реплики (сброс на sales) */
    offTopicCount?: number
    /** Имя менеджера из представления */
    managerName?: string | null
    /** Компания менеджера */
    managerCompany?: string | null
    /** Клиент уже узнал представление в Ack хотя бы раз */
    introAcknowledged?: boolean
  }
  /** Сущности из реплик менеджера (whatsapp, цена, потери…) */
  mentionedEntities?: string[]
  /** Суммы/цифры, названные менеджером в этой сессии */
  mentionedFigures?: string[]
  lastHookEntity?: string | null
  usedAsks?: string[]
  usedListeningAcks?: string[]
  lastReplyHadAsk?: boolean
  managerMonoStreak?: number
  turn: number
  lastIntent: string | null
  clientId: string
  /** Хамство: 0 / 1 / 2 */
  warningCount?: number
  sessionStatus?:
    | 'active'
    | 'warning'
    | 'failed'
    | 'completed'
    | 'terminated_etiquette'
    | 'terminated_offtopic'
  failReason?:
    | 'toxicity_limit_exceeded'
    | 'terminated_etiquette'
    | 'terminated_offtopic'
    | null
}

export interface SmartReplyResult {
  reply: string
  nextStep: number
  intent: Intent
  /** id из dialogue-bank / NLU (greeting, price_objection, …) */
  intentId?: string
  /** Обновлённый FSM после хода */
  dialogueState?: DialogueSnapshot
  /** Уверенность NLU 0..1+ */
  nluScore?: number
  /** Какое правило политики сработало */
  policyId?: string
  /** Задержка UI до показа ответа (мс), от сложности бита */
  typingDelayMs?: number
  /** true → статус «Внимательно читает...» */
  clientReading?: boolean
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
  intentLog?: Array<{
    intentId: string
    managerQuote: string
    /** Feedback-этап в момент реплики */
    stage?: string
    /** Сырой FSM stage */
    fsmStage?: string
    timestamp?: number
  }>
}

export interface MockData {
  product: Product
  manager: ManagerProfile
  history: RoleplayHistoryItem[]
  clients: ClientSession[]
}
