import { detectIntentId } from '../src/utils/intentRouter'

const cases: Array<[string, string, number?]> = [
  ['Здравствуйте, удобно говорить?', 'greeting', 0],
  ['Сколько стоит подписка в месяц?', 'price_inquiry', 2],
  ['Это слишком дорого для нас', 'price_objection', 3],
  ['Сколько заявок вы теряете из WhatsApp?', 'need_discovery', 2],
  ['Как работает интеграция с телефонией?', 'product_pitch_response', 3],
  ['Давайте назначим демо на четверг', 'closing', 4],
  ['Мне нужно подумать, не сейчас', 'doubt_skepticism', 3],
  ['У нас уже есть CRM на 1С', 'trust_competitors', 3],
  ['Я не решаю, нужно с партнёром', 'authority_gate', 3],
  ['Где хранятся персональные данные, 152-ФЗ?', 'security_compliance', 3],
  ['Сейчас некогда, перезвоните вечером', 'timing_busy', 2],
  ['Понимаю вашу боль по потерям заявок', 'rapport_pushback', 2],
  ['Какая окупаемость за три месяца?', 'value_challenge', 3],
  ['Сколько занимает внедрение и обучение?', 'implementation_fear', 3],
  ['чего', 'offtopic_confused', 2],
  ['Не звоните больше, это спам', 'aggression_pushback', 2],
  ['Как дела? Какая погода?', 'smalltalk_redirect', 1],
  ['Добрый день ещё раз, продолжим', 'greeting', 0],
  ['Добрый день, вернёмся к цене подписки', 'price_inquiry', 5],
]

let fail = 0
for (const [text, expected, step] of cases) {
  const { intentId, score } = detectIntentId(text, step ?? 0)
  const ok = intentId === expected
  if (!ok) fail++
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} step=${step ?? 0} got=${intentId}(${score}) want=${expected}`,
  )
  if (!ok) console.log(`     «${text}»`)
}
console.log(fail ? `\nFAILED ${fail}` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
