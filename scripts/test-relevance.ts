import { routeSmartReply } from '../src/utils/intentRouter'
import type { Scenario } from '../src/types'

const scenario = {
  clientReplies: ['ok'],
  intentReplies: { greeting: 'ok' },
  fallbackReply: 'fallback',
} as unknown as Scenario

const cases: Array<[string, RegExp]> = [
  ['Добрый день, удобно 1 минуту про запись пациентов?', /слушаю|минута|коротко|по делу|говорите/i],
  ['Скажите, заявки из WhatsApp иногда теряются?', /whatsapp|заявк|теря|висят|перезвон/i],
  ['А сколько примерно в неделю не дозваниваетесь?', /недозвон|не дозвани|не счита|цифр|неделю/i],
  ['Кто ведёт запись — журнал / Excel / WhatsApp?', /журнал|excel|whatsapp/i],
  ['Пациенты возвращаются на гигиену сами или обзвон руками?', /гигиен|обзвон|возврат|повторн/i],
  ['Сколько примерно пустых окон в неделю?', /окон|пуст/i],
  ['Подписка от 9900 — покажу потери на демо', /дорог|цена|пилот|месяц|кресл|филиал/i],
  ['Давайте зафиксируем демо завтра в 11:00, пришлю в WhatsApp', /демо|whatsapp|слот|завтра|кп/i],
]

let fail = 0
for (const [q, re] of cases) {
  const reply = routeSmartReply(q, 2, scenario, [], 'marina', [
    { role: 'manager', text: q },
  ]).reply
  const ok = re.test(reply)
  if (!ok) fail++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${q.slice(0, 48)}`)
  console.log(`   → ${reply}`)
}
process.exit(fail ? 1 : 0)
