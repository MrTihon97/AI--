/**
 * Черты персоны из ClientCard.mood (mock-data) —
 * скепсис / занятость влияют на beat-выбор (без LLM).
 */
import mockData from '../data/mock-data.json'

export type PersonaTraits = {
  skeptical: boolean
  busy: boolean
}

const EMPTY: PersonaTraits = { skeptical: false, busy: false }

/** Разбор строки настроения с карточки клиента. */
export function traitsFromMood(mood: string): PersonaTraits {
  const m = mood.toLowerCase().replace(/ё/g, 'е')
  return {
    skeptical: /скептич|сомнев|недовер/i.test(m),
    busy: /занят|между пациент|нет времени|спеш|у кресла|между при[её]м/i.test(
      m,
    ),
  }
}

export function traitsForClient(clientId?: string): PersonaTraits {
  if (!clientId) return EMPTY
  const clients = (mockData as { clients?: { id: string; mood?: string }[] })
    .clients
  const client = clients?.find((c) => c.id === clientId)
  if (client?.mood) return traitsFromMood(client.mood)
  // Fallback по id (если карточки нет в снимке)
  if (clientId === 'marina') return { skeptical: true, busy: true }
  return EMPTY
}

export function isPushbackPersona(traits: PersonaTraits): boolean {
  return traits.skeptical || traits.busy
}

/**
 * Менеджер закрыл сомнение цифрами / ROI / окупаемостью
 * (в текущей реплике или уже в слотах диалога).
 */
export function managerProvedValue(
  userText: string,
  slots: {
    developedArgument: boolean
    priceDiscussed: boolean
    objectionHandled: boolean
  },
): boolean {
  if (
    slots.developedArgument ||
    slots.priceDiscussed ||
    slots.objectionHandled
  ) {
    return true
  }
  const t = userText.toLowerCase().replace(/ё/g, 'е')
  if (
    /(\d+[.,]?\d*)\s*%/.test(t) &&
    /(потер|теря|неявк|запис|конверси)/i.test(t)
  ) {
    return true
  }
  if (
    /(\d+[.,]?\d*)\s*(тыс\.?|тысяч|₽|руб)/i.test(t) &&
    /(потер|выручк|недополуча|окупаем|неявк|заявк)/i.test(t)
  ) {
    return true
  }
  if (/(окупаем|\broi\b|в цифрах|на ваших цифр)/i.test(t)) return true
  return false
}

export type DemoGateSlots = {
  painFound: boolean
  priceDiscussed: boolean
  developedArgument: boolean
  objectionHandled: boolean
  demoOffered: boolean
  personaPushbackShown: boolean
  hasHandledObjection?: boolean
  closingAttempts?: number
}

/**
 * Guard на AGREED / closing_ok.
 * Скептичная персона: без hasHandledObjection демо не принимаем.
 * hasHandledObjection ставится только после ответа менеджера на pushback.
 */
export function canAcceptDemo(input: {
  clientId?: string
  userText: string
  slots: DemoGateSlots
}): boolean {
  const traits = traitsForClient(input.clientId)
  if (!isPushbackPersona(traits)) return true

  // Главный guard: возражение ещё не «отработано» ответом менеджера
  if (!input.slots.hasHandledObjection) return false

  const attempts = input.slots.closingAttempts ?? 0
  const value = managerProvedValue(input.userText, input.slots)

  // После ответа на pushback («в чём суть?») слот принимаем —
  // в т.ч. в том же ходе, что и презентация (attempts ещё 0→1)
  if (input.slots.personaPushbackShown) {
    if (value || attempts >= 1) return true
    // Питч + слот сразу после essence — не возвращать «сначала суть»
    if (
      /(модул|напоминан|whatsapp|crm|закрыва|статус|очеред|автоматиз|потер)/i.test(
        input.userText,
      )
    ) {
      return true
    }
    // Повторный чистый слот после отработанного возражения
    if (attempts >= 0 && /(zoom|зуум|демо|завтра|слот|\d{1,2}\s*[:.]\s*\d{2})/i.test(input.userText)) {
      return true
    }
  }

  if (attempts < 1) return false
  if (value) return true
  return false
}

/**
 * PROPOSE_TIME / Zoom при !hasHandledObjection → блок AGREED, уходим в objection beat.
 */
export function mustForceClosingPushback(input: {
  clientId?: string
  slots: {
    closingAttempts?: number
    personaPushbackShown?: boolean
    hasHandledObjection?: boolean
  }
}): boolean {
  const traits = traitsForClient(input.clientId)
  if (!isPushbackPersona(traits)) return false
  return !input.slots.hasHandledObjection
}

/** Какой objection-beat выбрать по mood карточки. */
export function objectionBeatKind(
  traits: PersonaTraits,
  closingAttempts = 0,
): 'busy' | 'skepticism' {
  if (traits.busy && traits.skeptical) {
    return closingAttempts % 2 === 0 ? 'busy' : 'skepticism'
  }
  if (traits.busy) return 'busy'
  return 'skepticism'
}
