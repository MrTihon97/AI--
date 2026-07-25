/**
 * Off-topic / invalid reply detection for session guard.
 * Off-topic = нет sales-ключевых слов И не валидный ответ в контексте звонка.
 */
import { containsAbuseOrProfanity } from '../utils/abuseDetect'
import { hasCallerIdentification } from '../dialogue/beats'
import {
  hasExplicitDateTimeSlot,
  isSlotTimeInput,
} from '../dialogue/entities'
import { isDevelopedArgument, isNonsenseSpam } from './intentMatcher'

export const OFFTOPIC_TERMINATE_REPLY =
  'Я вижу, что предметного разговора не получается. Всего доброго.'

const SHORT_HELLO_RE =
  /^(привет|приветик|здравствуй(те)?|добрый(\s+(день|вечер|утро))?|алло|ало|хай|хеллоу|салют|да|слушаю|угу|ага)[.!?…]*$/i

const SHORT_ACK_RE =
  /^(ок|окей|хорошо|да|нет|ладно|договорились|принято|понял|поняла|супер|ясно)[.!?…]*$/i

/** Ключевые слова продаж / предметного звонка */
export const SALES_KEYWORDS_RE =
  /(crm|дента|заявк|потер|неявк|запис|отмен|whatsapp|ватсап|вотсап|zoom|зуум|демо|слот|цен[аыуе]|стоим|подписк|руб|тыс|компани|зовут|удобно|минут|окуп|roi|интеграц|модул|автобот|автоответ|админ|журнал|excel|эксель|конверси|филиал|созвон|пациент|клиник|кресл|визит|напомина|мессенджер|1с|пилот|встреч|дашборд|аналитик|очер[её]д|выручк|недополуча)/i

/**
 * Валидная реплика менеджера: продажи / представление / слот / короткий ack / hello.
 */
export function isSalesRelevantOrValidReply(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (SHORT_HELLO_RE.test(t)) return true
  if (SHORT_ACK_RE.test(t)) return true
  if (isSlotTimeInput(t) || hasExplicitDateTimeSlot(t)) return true
  if (hasCallerIdentification(t)) return true
  if (SALES_KEYWORDS_RE.test(t)) return true
  if (isDevelopedArgument(t)) return true
  // Осмысленный вопрос ≥10 символов — попытка вести диалог
  if (/\?/.test(t) && t.length >= 10) return true
  return false
}

/**
 * Off-topic: нет sales-маркеров и не валидный ответ
 * (в т.ч. nonsense / smalltalk вне темы).
 */
export function isOffTopicMessage(text: string): boolean {
  if (!text?.trim()) return true
  // Мат обрабатывает другой guard
  if (containsAbuseOrProfanity(text)) return false
  if (isSalesRelevantOrValidReply(text)) return false
  if (isNonsenseSpam(text)) return true
  // Smalltalk / мусор без sales-контекста
  const t = text.toLowerCase().replace(/ё/g, 'е')
  if (
    /(как\s+дела|что\s+нового|погода|кино|футбол|анекдот|что\s+слышно|скучно|привет\s+ещ[её])/i.test(
      t,
    )
  ) {
    return true
  }
  // Короткая реплика без темы
  if (t.length < 12 && !/\?/.test(t)) return true
  return true
}
