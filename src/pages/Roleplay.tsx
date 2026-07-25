import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Briefcase,
  Goal,
  MessageSquare,
  Send,
  Sparkles,
  Target,
  UserRound,
  X,
} from 'lucide-react'
import {
  buildFeedbackSession,
  getClientById,
  getSmartReply,
  listClients,
} from '../services/api'
import { resolveGlobalSessionGuards } from '../services/roleplayApi'
import type { ChatMessage, ClientSession, DialogueSnapshot } from '../types'
import { RoleplayPageSkeleton, Skeleton } from '../components/Skeleton'
import { AppNav } from '../components/AppNav'
import { useVisualViewportHeight } from '../hooks/useVisualViewportHeight'
import { delay } from '../utils/zones'
import { initials } from '../utils/initials'
import { streamByWords, typingDelayFor } from '../utils/streamText'
import { isDevelopedArgument } from '../services/intentMatcher'
import { salesStageToFeedbackStage, looksLikeClosingProposal } from '../services/feedbackEngine'
import { containsAbuseOrProfanity } from '../utils/abuseDetect'
import { isSessionLocked } from '../dialogue/toxicity'

type ClientOption = {
  id: string
  name: string
  role: string
  segment: string
  mood: string
}

type Phase = 'select' | 'brief' | 'chat'

const CHAT_TIPS = [
  'Сначала выявите боль — цену называйте после.',
  'На «дорого» посчитайте потери клиники в рублях.',
  'Зафиксируйте next step: дата, слот, WhatsApp.',
  'Говорите выгодами под боль, а не списком функций.',
]

/**
 * Подсказки по этапу продажи.
 * label — тезис на чипе (3–4 слова); text — полный шаблон в textarea.
 * В CONTACT — плейсхолдеры […]: при клике выделяются в поле.
 */
type StageSuggestion = { label: string; text: string }

const STAGE_SUGGESTIONS: Record<string, StageSuggestion[]> = {
  CONTACT: [
    {
      label: 'Представиться',
      text: 'Здравствуйте! Меня зовут [Ваше имя], компания [Название CRM]',
    },
    {
      label: 'Цель звонка',
      text: 'Добрый день! Звоню по поводу автоматизации ваших клиник',
    },
    {
      label: 'Удобно сейчас?',
      text: 'Удобно сейчас обсудить работу филиалов?',
    },
    {
      label: 'Ценность для клиники',
      text: 'Помогаем медицинским центрам сократить потери пациентов на записи',
    },
  ],
  NEEDS: [
    {
      label: 'Потери записей',
      text: 'Сколько записей теряется у администратора?',
    },
    {
      label: 'Повторные визиты',
      text: 'Как сейчас фиксируете повторные визиты?',
    },
    {
      label: 'Кто ведёт запись',
      text: 'Кто ведет запись — Excel или WhatsApp?',
    },
    {
      label: 'Где срывается запись',
      text: 'Где чаще всего срывается запись пациентов?',
    },
    {
      label: 'Админы на смене',
      text: 'Сколько администраторов работают на смене?',
    },
  ],
  PRESENTATION: [
    {
      label: 'Неявки минус 20%',
      text: 'Покажем, как сократить неявки на 20%',
    },
    {
      label: 'Автонапоминания',
      text: 'Система автоматически напоминает пациентам о визите',
    },
    {
      label: 'Быстрый пилот',
      text: 'Внедрение занимает всего пару дней без остановки клиники',
    },
    {
      label: 'Дашборд по сети',
      text: 'Единый дашборд по всем филиалам для руководителя',
    },
  ],
  OBJECTIONS: [
    {
      label: 'Сравнить стек',
      text: 'Понимаю. Давайте сравним с вашим текущим стеком',
    },
    {
      label: 'Окупаемость за месяц',
      text: 'Окупаемость клиника получает уже в первый месяц работы',
    },
    {
      label: 'Пилот на филиале',
      text: 'Можно протестировать функционал на одном филиале',
    },
    {
      label: 'Цена vs потери',
      text: 'Стоимость подписки полностью перекрывается парой спасенных записей',
    },
  ],
  CLOSING: [
    {
      label: 'Демо в Zoom',
      text: 'Предлагаю короткое демо в Zoom на 15 минут',
    },
    {
      label: 'Слот день и время',
      text: 'Зафиксируем слот: завтра в 14:00 или 16:00?',
    },
    {
      label: 'КП в WhatsApp',
      text: 'Отправлю презентацию и расчет окупаемости в WhatsApp',
    },
    {
      label: 'Тест для главврача',
      text: 'Давайте согласуем тестовый доступ для главного врача',
    },
  ],
}

/** FSM stage → ключ STAGE_SUGGESTIONS */
function stageSuggestionKey(stage?: string | null): string | null {
  switch (stage) {
    case 'intro':
    case 'contact':
    case 'CONTACT':
      return 'CONTACT'
    case 'discovery':
    case 'needs':
    case 'NEEDS':
      return 'NEEDS'
    case 'presentation':
    case 'PRESENTATION':
      return 'PRESENTATION'
    case 'objection':
    case 'objections':
    case 'OBJECTIONS':
      return 'OBJECTIONS'
    case 'closing':
    case 'CLOSING':
      return 'CLOSING'
    case 'ended':
      return null
    default:
      return 'CONTACT'
  }
}

function suggestionsForStage(stage?: string | null): StageSuggestion[] {
  const key = stageSuggestionKey(stage)
  if (!key) return []
  return STAGE_SUGGESTIONS[key] ?? STAGE_SUGGESTIONS.CONTACT!
}

/** Первый плейсхолдер `[…]` для выделения в textarea. */
function firstPlaceholderRange(
  text: string,
): { start: number; end: number } | null {
  const m = /\[[^\]]+\]/.exec(text)
  if (!m || m.index == null) return null
  return { start: m.index, end: m.index + m[0].length }
}

const STAGE_HINT: Record<string, string> = {
  intro: 'Контакт',
  discovery: 'Выявление потребностей',
  presentation: 'Презентация',
  objection: 'Возражения',
  closing: 'Закрытие',
  ended: 'Диалог завершён',
}

const NEAR_BOTTOM_PX = 96

function tipForStep(managerTurns: number): string {
  return CHAT_TIPS[managerTurns % CHAT_TIPS.length]!
}

function ClientStatus({
  typing,
  reading,
  failed,
  role,
}: {
  typing: boolean
  reading?: boolean
  failed?: boolean
  /** Роль / сегмент клиента — подзаголовок вместо голого «В сети» */
  role?: string
}) {
  if (failed) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-600">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden />
        Сессия прервана
      </p>
    )
  }

  if (typing) {
    const label = reading ? 'Внимательно читает...' : 'Печатает...'
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-brand transition-colors duration-300">
        <span
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand"
          aria-hidden
        />
        {label}
      </p>
    )
  }

  const roleLabel = role?.trim()
  return (
    <p className="truncate text-xs font-medium text-slate-500">
      {roleLabel ? roleLabel : 'В сети'}
    </p>
  )
}

function TypingIndicator({
  name,
  reading,
}: {
  name: string
  reading?: boolean
}) {
  const label = reading
    ? `${name} внимательно читает вашу реплику`
    : `${name} печатает`

  return (
    <div className="animate-fade-up flex justify-start">
      <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/80 transition-all duration-300">
        <span key={label} className="animate-fade-in font-medium text-slate-600">
          {label}
        </span>
        <span className="inline-flex gap-0.5" aria-hidden>
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
        </span>
      </div>
    </div>
  )
}

function ChatBubble({
  message,
  streaming,
}: {
  message: ChatMessage
  streaming?: boolean
}) {
  const isManager = message.role === 'manager'
  return (
    <div
      className={`animate-fade-up flex ${isManager ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isManager
            ? 'rounded-br-md bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.65)]'
            : 'rounded-bl-md bg-white/95 text-slate-800 shadow-sm ring-1 ring-blue-100/80'
        }`}
      >
        {message.text}
        {streaming && !isManager ? (
          <span className="stream-caret ml-0.5 inline-block" aria-hidden />
        ) : null}
      </div>
    </div>
  )
}

export function Roleplay() {
  const navigate = useNavigate()
  const viewport = useVisualViewportHeight()
  const [phase, setPhase] = useState<Phase>('select')
  const [clients, setClients] = useState<ClientOption[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [client, setClient] = useState<ClientSession | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [scriptStep, setScriptStep] = useState(0)
  const [dialogueState, setDialogueState] = useState<DialogueSnapshot | null>(
    null,
  )
  const [intentLog, setIntentLog] = useState<
    Array<{ intentId: string; managerQuote: string }>
  >([])
  const [clientTyping, setClientTyping] = useState(false)
  const [clientReading, setClientReading] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const typingLock = useRef(false)
  const messagesRef = useRef<ChatMessage[]>([])
  const intentLogRef = useRef(intentLog)
  const dialogueStateRef = useRef<DialogueSnapshot | null>(null)
  const startAbortRef = useRef(0)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    intentLogRef.current = intentLog
  }, [intentLog])

  useEffect(() => {
    dialogueStateRef.current = dialogueState
  }, [dialogueState])

  const loadClients = async () => {
    setLoadingList(true)
    setListError(null)
    try {
      setClients(await listClients())
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Не удалось загрузить клиентов')
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => {
    void loadClients()
  }, [])

  const handleChatScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottom.current = distance <= NEAR_BOTTOM_PX
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) {
      bottomRef.current?.scrollIntoView({ behavior })
      return
    }
    el.scrollTo({ top: el.scrollHeight, behavior })
  }

  useEffect(() => {
    if (!stickToBottom.current) return
    scrollToBottom(streamingId ? 'auto' : 'smooth')
  }, [messages, clientTyping, streamingId])

  useEffect(() => {
    if (phase !== 'brief') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBrief()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  const applyQuickReply = (text: string) => {
    setInput(text)
    window.setTimeout(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const range = firstPlaceholderRange(text)
      if (range) {
        // Сразу выделяем [Ваше имя] / [Название CRM] — можно печатать поверх
        el.setSelectionRange(range.start, range.end)
      } else {
        const len = text.length
        el.setSelectionRange(len, len)
      }
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`
    }, 0)
  }

  const resizeComposer = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 220)}px`
  }

  useEffect(() => {
    resizeComposer()
  }, [input])

  const openBrief = async (id: string) => {
    setSelectedId(id)
    setLoadingDetails(true)
    setBriefError(null)
    setClient(null)
    setPhase('brief')
    try {
      setClient(await getClientById(id))
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : 'Не удалось загрузить карточку')
    } finally {
      setLoadingDetails(false)
    }
  }

  const closeBrief = () => {
    setPhase('select')
    setSelectedId(null)
    setBriefError(null)
  }

  const revealClientReply = async (fullText: string, token: number) => {
    const id = `c-${Date.now()}`
    setClientTyping(false)
    setStreamingId(id)
    setMessages((prev) => [
      ...prev,
      { id, role: 'client', text: '', ts: Date.now() },
    ])

    await streamByWords(
      fullText,
      (partial) => {
        if (token !== startAbortRef.current) return
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, text: partial } : m)),
        )
      },
      { aborted: () => token !== startAbortRef.current },
    )

    if (token !== startAbortRef.current) return
    setStreamingId(null)
    typingLock.current = false
    window.setTimeout(() => inputRef.current?.focus(), 40)
  }

  const startChat = async () => {
    if (!client) return
    const token = ++startAbortRef.current
    stickToBottom.current = true
    setPhase('chat')
    setMessages([])
    setScriptStep(0)
    setDialogueState(null)
    setIntentLog([])
    setInput('')
    setStreamingId(null)
    setClientTyping(true)
    setClientReading(false)
    typingLock.current = true

    try {
      const started = Date.now()
      const { reply, nextStep, dialogueState: nextDs, typingDelayMs } =
        await getSmartReply(
        'Здравствуйте, удобно говорить пару минут?',
        {
          clientId: client.id,
          scriptStep: 0,
          messages: [],
          dialogueState: null,
        },
      )
      const waitLeft = Math.max(
        0,
        typingDelayFor(reply, '', typingDelayMs ?? 1000) -
          (Date.now() - started),
      )
      await delay(waitLeft)
      if (token !== startAbortRef.current) return
      setScriptStep(nextStep)
      if (nextDs) setDialogueState(nextDs)
      await revealClientReply(reply, token)
    } catch {
      const first =
        client.scenario.intentReplies.greeting ||
        client.scenario.clientReplies[0]
      await delay(typingDelayFor(first))
      if (token !== startAbortRef.current) return
      setScriptStep(1)
      await revealClientReply(first, token)
    }
  }

  const leaveChat = () => {
    if (messages.length > 0 || clientTyping || streamingId) {
      if (!confirm('Выйти из диалога? Прогресс этой ролёвки не сохранится.')) {
        return
      }
    }
    startAbortRef.current += 1
    typingLock.current = false
    setClientTyping(false)
    setClientReading(false)
    setStreamingId(null)
    setMessages([])
    setInput('')
    setDialogueState(null)
    setPhase('select')
    setSelectedId(null)
  }

  const sendMessage = async () => {
    if (
      !client ||
      !input.trim() ||
      clientTyping ||
      streamingId ||
      typingLock.current ||
      isSessionLocked(
        dialogueStateRef.current?.sessionStatus,
        dialogueStateRef.current?.failReason,
      ) ||
      dialogueStateRef.current?.sessionStatus === 'completed'
    ) {
      return
    }

    const userMessage = input.trim()
    setInput('')
    stickToBottom.current = true

    const managerMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      role: 'manager',
      text: userMessage,
      ts: Date.now(),
      // Этап FSM в момент отправки — разбор цитирует по нему
      stage: dialogueStateRef.current?.stage ?? 'intro',
    }
    const historyMessages = [...messagesRef.current, managerMsg]
    setMessages(historyMessages)

    const token = ++startAbortRef.current
    typingLock.current = true
    setClientTyping(true)
    // Статус «читает» уточним после ответа движка (по сложности бита)
    setClientReading(isDevelopedArgument(userMessage))

    try {
      const started = Date.now()

      // Единый вход: getSmartReply сам гоняет глобальные гварды
      // (этика → оффтоп → персона). Марина / Артём / любой clientId —
      // один и тот же пайплайн, без persona-bypass.
      const {
        reply,
        nextStep,
        intentId,
        dialogueState: nextDs,
        typingDelayMs,
        clientReading,
      } = await getSmartReply(userMessage, {
        clientId: client.id,
        scriptStep,
        messages: historyMessages,
        dialogueState: dialogueStateRef.current,
      })

      if (typeof clientReading === 'boolean') {
        setClientReading(clientReading)
      }

      const waitLeft = Math.max(
        0,
        typingDelayFor(reply, userMessage, typingDelayMs) -
          (Date.now() - started),
      )
      await delay(waitLeft)
      if (token !== startAbortRef.current) return

      const sendFsm = managerMsg.stage ?? 'intro'
      // Если ход закрыл сделку / intent closing — stamp CLOSING
      // (send-time stage часто ещё objection/presentation)
      const becameClosing =
        intentId === 'closing' ||
        /(?:^|:)closing/i.test(intentId ?? '') ||
        nextDs?.stage === 'closing' ||
        nextDs?.sessionStatus === 'completed' ||
        (looksLikeClosingProposal(userMessage) &&
          Boolean(
            nextDs?.slots?.demoOffered ||
              dialogueStateRef.current?.slots?.demoOffered ||
              nextDs?.stage === 'objection' ||
              nextDs?.stage === 'presentation',
          ))

      const fsmStage = becameClosing ? 'closing' : sendFsm
      const feedbackStage = becameClosing
        ? 'closing'
        : salesStageToFeedbackStage(sendFsm)
      setIntentLog((prev) => [
        ...prev,
        {
          intentId: intentId ?? 'unknown',
          managerQuote: userMessage,
          stage: feedbackStage,
          fsmStage,
          timestamp: managerMsg.ts,
        },
      ])
      // Дописываем intent (+ stage closing) на сообщение менеджера
      setMessages((prev) =>
        prev.map((m) =>
          m.id === managerMsg.id
            ? {
                ...m,
                intent: intentId ?? 'unknown',
                stage: becameClosing ? 'closing' : m.stage,
              }
            : m,
        ),
      )
      // Глобальный бан (этика/оффтоп): script step не двигаем вперёд
      const blocked =
        nextDs?.sessionStatus === 'terminated_etiquette' ||
        nextDs?.sessionStatus === 'terminated_offtopic' ||
        nextDs?.sessionStatus === 'warning' ||
        nextDs?.failReason === 'terminated_etiquette' ||
        nextDs?.failReason === 'terminated_offtopic'
      if (!blocked) {
        setScriptStep(nextStep)
      }
      // Синхронно до стриминга — иначе следующий ход видит stale state
      if (nextDs) {
        dialogueStateRef.current = nextDs
        setDialogueState(nextDs)
      }
      setClientReading(false)
      await revealClientReply(reply, token)
    } catch (e) {
      console.error(e)
      setClientReading(false)
      if (token !== startAbortRef.current) return
      // Даже в fallback: глобальные гварды важнее persona script
      const emergency = resolveGlobalSessionGuards({
        userText: userMessage,
        clientId: client.id,
        historyMessages,
        dialogueState: dialogueStateRef.current,
        scriptStep,
      })
      if (emergency.kind === 'block') {
        if (emergency.result.dialogueState) {
          dialogueStateRef.current = emergency.result.dialogueState
          setDialogueState(emergency.result.dialogueState)
        }
        await revealClientReply(emergency.result.reply, token)
        return
      }
      if (containsAbuseOrProfanity(userMessage)) {
        // safety: мат не должен уйти в fallback-реплику персоны
        return
      }
      await revealClientReply(client.scenario.fallbackReply, token)
    }
  }

  const finishRoleplay = async () => {
    if (!client || finishing || clientTyping || streamingId) return

    const failed = isSessionLocked(
      dialogueStateRef.current?.sessionStatus,
      dialogueStateRef.current?.failReason,
    )

    const managerCount = messagesRef.current.filter(
      (m) => m.role === 'manager',
    ).length
    if (
      !failed &&
      managerCount < 2 &&
      !confirm(
        'В диалоге мало ваших реплик — разбор будет слабым. Всё равно завершить?',
      )
    ) {
      return
    }

    setFinishing(true)
    try {
      const managerMessages = messagesRef.current
        .filter((m) => m.role === 'manager')
        .map((m) => m.text)

      const session = await buildFeedbackSession(
        client.id,
        managerMessages,
        intentLogRef.current,
        dialogueStateRef.current,
      )

      // Салют / confetti — только на экране разбора при verdict=passed.
      // Здесь всегда нейтральная пауза перед переходом.
      const passed = session.feedback.verdict === 'passed'
      await delay(passed ? 500 : 400)

      navigate('/feedback', {
        state: {
          ...session,
          messages: messagesRef.current,
          sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось получить разбор')
      setFinishing(false)
    }
  }

  if (loadingList && phase === 'select') {
    return (
      <>
        <AppNav />
        <RoleplayPageSkeleton />
      </>
    )
  }

  if (phase === 'select' || phase === 'brief') {
    return (
      <>
        <AppNav />
      <div className="mx-auto max-w-4xl px-4 py-6 pb-10 sm:py-8">
        <Link
          to="/"
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand md:mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Выбор клиента
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Изучите карточку, затем начните диалог. Клиент отвечает через Smart Mock.
        </p>

        {listError ? (
          <div className="soft-card mt-6 rounded-[22px] p-6 text-center">
            <p className="text-sm text-slate-600">{listError}</p>
            <button
              type="button"
              onClick={() => void loadClients()}
              className="btn-glow mt-4 rounded-full px-5 py-2.5 text-sm font-semibold"
            >
              Повторить
            </button>
          </div>
        ) : (
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {clients.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openBrief(item.id)}
                className={`soft-card rounded-[22px] p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-24px_rgba(37,99,235,0.45)] ${
                  selectedId === item.id ? 'ring-2 ring-brand/30' : ''
                }`}
              >
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-sm font-bold text-white shadow-[0_8px_18px_rgba(59,130,246,0.35)]">
                    {initials(item.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {item.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">{item.segment}</p>
                  </div>
                </div>
                <p className="text-sm leading-snug text-slate-600">{item.role}</p>
                <p className="mt-2 text-xs text-amber-700">{item.mood}</p>
              </button>
            ))}
          </div>
        )}

        {phase === 'brief' && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 p-4 backdrop-blur-[2px] sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-card-title"
            onClick={closeBrief}
          >
            <div
              className="soft-card max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[22px] p-5 shadow-2xl sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <h2
                  id="client-card-title"
                  className="font-display text-lg font-bold text-slate-900"
                >
                  Карточка клиента
                </h2>
                <button
                  type="button"
                  onClick={closeBrief}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Закрыть"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {loadingDetails ? (
                <div className="space-y-3">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : briefError ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-slate-600">{briefError}</p>
                  <button
                    type="button"
                    onClick={() => selectedId && void openBrief(selectedId)}
                    className="btn-glow rounded-full px-5 py-2.5 text-sm font-semibold"
                  >
                    Повторить
                  </button>
                </div>
              ) : client ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="font-display flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-lg font-bold text-white shadow-[0_8px_20px_rgba(59,130,246,0.4)]">
                      {initials(client.name)}
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900">
                        {client.name}
                      </p>
                      <p className="flex items-start gap-1.5 text-sm text-slate-600">
                        <Briefcase className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        {client.role}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-100">
                    Настроение: {client.mood}
                  </p>

                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <UserRound className="h-3.5 w-3.5" />
                      Сегмент и контекст
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {client.segment}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {client.portrait}
                    </p>
                  </div>

                  <div className="mt-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <Target className="h-3.5 w-3.5" />
                      Боли
                    </p>
                    <ul className="mt-2 space-y-2">
                      {client.pains.map((pain) => (
                        <li
                          key={pain}
                          className="flex gap-2 rounded-xl bg-red-50/70 px-3 py-2 text-sm text-slate-700"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zone-red" />
                          {pain}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {client.goals.length > 0 && (
                    <div className="mt-4">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        <Goal className="h-3.5 w-3.5" />
                        Цели
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {client.goals.map((goal) => (
                          <li
                            key={goal}
                            className="flex gap-2 text-sm text-slate-700"
                          >
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                            {goal}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void startChat()}
                    className="btn-glow mt-6 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold"
                  >
                    <MessageSquare className="h-4 w-4" />
                    Начать диалог
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
      </>
    )
  }

  if (!client) return null

  const managerTurns = messages.filter((m) => m.role === 'manager').length
  const sessionFailed = isSessionLocked(
    dialogueState?.sessionStatus,
    dialogueState?.failReason,
  )
  const sessionCompleted = dialogueState?.sessionStatus === 'completed'
  const warningCount = dialogueState?.warningCount ?? 0
  const showToxicityBanner = warningCount >= 1 && !sessionFailed
  const busy = clientTyping || Boolean(streamingId) || finishing
  const inputDisabled = busy || sessionFailed || sessionCompleted
  const stageChips = suggestionsForStage(dialogueState?.stage)
  const chatHeight =
    viewport != null
      ? `${viewport.height}px`
      : '100dvh'
  const chatTop = viewport?.offsetTop ?? 0

  return (
    <>
      <div className="hidden md:block">
        <AppNav />
      </div>
      <div
        className="chat-shell soft-card relative fixed inset-x-0 z-50 mx-auto flex w-full max-w-3xl flex-col overflow-hidden md:relative md:inset-auto md:my-4 md:rounded-[22px]"
        style={{
          height: chatHeight,
          maxHeight: chatHeight,
          top: chatTop,
        }}
      >
      <header className="shrink-0 border-b border-blue-100/80 bg-white/70 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={leaveChat}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-brand"
              aria-label="К выбору клиента"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="relative shrink-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-xs font-bold text-white shadow-[0_6px_14px_rgba(59,130,246,0.35)]">
                {initials(client.name)}
              </div>
              <span
                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                  sessionFailed
                    ? 'bg-rose-500'
                    : clientTyping || streamingId
                      ? 'bg-brand'
                      : 'bg-emerald-500'
                }`}
                aria-hidden
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {client.name}
              </p>
              <ClientStatus
                typing={Boolean(clientTyping || streamingId)}
                reading={clientReading}
                failed={sessionFailed}
                role={
                  client.role
                    ? `${client.name} • ${client.role}`
                    : undefined
                }
              />
              {sessionFailed ? (
                <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-rose-600">
                  Сессия прервана
                </p>
              ) : dialogueState?.stage ? (
                <p className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Этап: {STAGE_HINT[dialogueState.stage] ?? dialogueState.stage}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            disabled={busy && !sessionFailed && !sessionCompleted}
            onClick={() => void finishRoleplay()}
            className={
              sessionFailed
                ? 'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50'
                : sessionCompleted
                  ? 'btn-glow inline-flex shrink-0 animate-pulse items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold ring-2 ring-brand/40 disabled:opacity-50'
                  : 'btn-glow inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold disabled:opacity-50'
            }
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {finishing
                ? 'Готовим разбор…'
                : sessionFailed
                  ? 'Задание провалено — Перейти к разбору'
                  : sessionCompleted
                    ? 'Завершить и получить разбор'
                    : 'Завершить и получить разбор'}
            </span>
            <span className="sm:hidden">
              {finishing
                ? '…'
                : sessionFailed
                  ? 'Провал'
                  : sessionCompleted
                    ? 'Разбор'
                    : 'Разбор'}
            </span>
          </button>
        </div>
        {showToxicityBanner ? (
          <div
            className="border-t border-amber-200/80 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-900 sm:px-4"
            role="status"
          >
            ⚠️ Предупреждение ({warningCount}/2): Соблюдайте деловой этикет
          </div>
        ) : null}
        {sessionFailed ? (
          <div
            className="border-t border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-800 sm:px-4"
            role="alert"
          >
            Разговор прерван из‑за нарушения деловой этики
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 border-t border-blue-50 px-3 py-1.5 sm:px-4">
            <p className="truncate text-[11px] text-slate-500">
              Подсказка: {tipForStep(managerTurns)}
            </p>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
              {managerTurns} репл.
            </span>
          </div>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={handleChatScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-gradient-to-b from-slate-50/80 to-blue-50/40 px-3 py-3 sm:px-4 sm:py-4"
      >
        {messages.length === 0 && !clientTyping ? (
          <p className="py-10 text-center text-sm text-slate-400">
            Клиент скоро напишет…
          </p>
        ) : null}
        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            message={msg}
            streaming={msg.id === streamingId}
          />
        ))}
        {clientTyping && (
          <TypingIndicator name={client.name} reading={clientReading} />
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-blue-100/80 bg-white/90 backdrop-blur-md">
        {!finishing && !sessionFailed && !sessionCompleted && stageChips.length > 0 ? (
          <div className="flex min-w-0 max-w-full flex-wrap gap-2 overflow-hidden px-3 pt-2.5 pb-1">
            {stageChips.map((item) => (
              <button
                key={`${dialogueState?.stage ?? 'intro'}-${item.label}`}
                type="button"
                disabled={inputDisabled}
                title={item.text}
                onClick={() => applyQuickReply(item.text)}
                className="shrink-0 rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-brand ring-1 ring-blue-100 transition hover:bg-blue-100/80 disabled:opacity-40"
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        {sessionFailed || sessionCompleted ? (
          <div className="flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <p className="text-center text-xs font-medium text-slate-600">
              {sessionFailed
                ? 'Ввод заблокирован. Получите разбор по этике.'
                : 'Договорились — получите разбор.'}
            </p>
            <button
              type="button"
              disabled={finishing}
              onClick={() => void finishRoleplay()}
              className={
                sessionFailed
                  ? 'inline-flex w-full items-center justify-center gap-2 rounded-full bg-rose-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50'
                  : 'btn-glow inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-bold disabled:opacity-50'
              }
            >
              <Sparkles className="h-4 w-4" />
              {finishing
                ? 'Готовим разбор…'
                : 'Завершить и получить разбор'}
            </button>
          </div>
        ) : (
        <form
          className="flex items-end gap-2 p-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault()
            void sendMessage()
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={resizeComposer}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendMessage()
              }
            }}
            rows={3}
            disabled={inputDisabled}
            placeholder="Напишите реплику менеджера…"
            className="min-h-[72px] max-h-[220px] flex-1 resize-y overflow-y-auto rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-base leading-relaxed outline-none ring-brand/20 placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-50 sm:text-sm"
          />
          <button
            type="submit"
            disabled={!input.trim() || inputDisabled}
            className="btn-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
            aria-label="Отправить"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
        )}
      </div>

      {finishing ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/55 backdrop-blur-[2px]">
          <div className="soft-card pointer-events-none rounded-2xl px-5 py-4 text-center shadow-lg">
            <Sparkles className="mx-auto h-6 w-6 text-brand" />
            <p className="font-display mt-2 text-sm font-bold text-slate-900">
              Формируем разбор…
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {sessionFailed
                ? 'Сессия завершена досрочно'
                : 'Считаем этапы по вашим репликам'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
    </>
  )
}
