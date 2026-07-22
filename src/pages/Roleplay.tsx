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
import type { ChatMessage, ClientSession } from '../types'
import { Skeleton } from '../components/Skeleton'
import { delay } from '../utils/zones'
import { initials } from '../utils/initials'
import { streamByWords, typingDelayFor } from '../utils/streamText'

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

function tipForStep(managerTurns: number): string {
  return CHAT_TIPS[managerTurns % CHAT_TIPS.length]!
}

function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="flex justify-start">
      <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/80">
        <span className="font-medium text-slate-600">{name} печатает</span>
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
  const [intentLog, setIntentLog] = useState<
    Array<{ intentId: string; managerQuote: string }>
  >([])
  const [clientTyping, setClientTyping] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const typingLock = useRef(false)
  const messagesRef = useRef<ChatMessage[]>([])
  const intentLogRef = useRef(intentLog)
  const startAbortRef = useRef(0)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    intentLogRef.current = intentLog
  }, [intentLog])

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, clientTyping, streamingId])

  useEffect(() => {
    if (phase !== 'brief') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBrief()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

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
    setPhase('chat')
    setMessages([])
    setScriptStep(0)
    setIntentLog([])
    setInput('')
    setStreamingId(null)
    setClientTyping(true)
    typingLock.current = true

    try {
      const started = Date.now()
      const { reply } = await getSmartReply(
        'Здравствуйте, удобно говорить пару минут?',
        {
          clientId: client.id,
          scriptStep: 0,
          messages: [],
        },
      )
      const waitLeft = Math.max(
        0,
        typingDelayFor(reply) - (Date.now() - started),
      )
      await delay(waitLeft)
      if (token !== startAbortRef.current) return
      setScriptStep(1)
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
    setStreamingId(null)
    setMessages([])
    setInput('')
    setPhase('select')
    setSelectedId(null)
  }

  const sendMessage = async () => {
    if (
      !client ||
      !input.trim() ||
      clientTyping ||
      streamingId ||
      typingLock.current
    ) {
      return
    }

    const userMessage = input.trim()
    setInput('')

    const managerMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      role: 'manager',
      text: userMessage,
      ts: Date.now(),
    }
    const historyMessages = [...messagesRef.current, managerMsg]
    setMessages(historyMessages)

    const token = ++startAbortRef.current
    typingLock.current = true
    setClientTyping(true)

    try {
      const started = Date.now()
      const { reply, nextStep, intentId } = await getSmartReply(userMessage, {
        clientId: client.id,
        scriptStep,
        messages: historyMessages,
      })

      const waitLeft = Math.max(0, typingDelayFor(reply) - (Date.now() - started))
      await delay(waitLeft)
      if (token !== startAbortRef.current) return

      setIntentLog((prev) => [
        ...prev,
        {
          intentId: intentId ?? 'unknown',
          managerQuote: userMessage,
        },
      ])
      setScriptStep(nextStep)
      await revealClientReply(reply, token)
    } catch (e) {
      console.error(e)
      if (token !== startAbortRef.current) return
      await revealClientReply(client.scenario.fallbackReply, token)
    }
  }

  const finishRoleplay = async () => {
    if (!client || finishing || clientTyping || streamingId) return

    const managerCount = messagesRef.current.filter(
      (m) => m.role === 'manager',
    ).length
    if (
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
      )
      navigate('/feedback', {
        state: {
          ...session,
          messages: messagesRef.current,
        },
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось получить разбор')
      setFinishing(false)
    }
  }

  if (phase === 'select' || phase === 'brief') {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand"
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

        {loadingList ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-40 rounded-[22px]" />
            <Skeleton className="h-40 rounded-[22px]" />
          </div>
        ) : listError ? (
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
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
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
    )
  }

  if (!client) return null

  const managerTurns = messages.filter((m) => m.role === 'manager').length
  const busy = clientTyping || Boolean(streamingId) || finishing

  return (
    <div className="soft-card mx-auto flex h-[100dvh] max-w-3xl flex-col overflow-hidden sm:my-4 sm:h-[calc(100dvh-2rem)] sm:rounded-[22px]">
      <header className="border-b border-blue-100/80 bg-white/70 backdrop-blur-md">
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
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-xs font-bold text-white shadow-[0_6px_14px_rgba(59,130,246,0.35)]">
              {initials(client.name)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {client.name}
              </p>
              <p className="truncate text-xs text-slate-500">{client.role}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void finishRoleplay()}
            className="btn-glow inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {finishing ? 'Готовим разбор…' : 'Завершить и получить разбор'}
            </span>
            <span className="sm:hidden">{finishing ? '…' : 'Разбор'}</span>
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-blue-50 px-3 py-1.5 sm:px-4">
          <p className="truncate text-[11px] text-slate-500">
            Подсказка: {tipForStep(managerTurns)}
          </p>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
            {managerTurns} репл.
          </span>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto bg-gradient-to-b from-slate-50/80 to-blue-50/40 px-4 py-4">
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
        {clientTyping && <TypingIndicator name={client.name} />}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-blue-100/80 bg-white/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md"
        onSubmit={(e) => {
          e.preventDefault()
          void sendMessage()
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void sendMessage()
            }
          }}
          rows={2}
          disabled={busy}
          placeholder="Напишите реплику менеджера…"
          className="min-h-[48px] flex-1 resize-none rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm outline-none ring-brand/20 placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy}
          className="btn-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
          aria-label="Отправить"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
