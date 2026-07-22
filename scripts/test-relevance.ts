import { routeSmartReply } from '../src/utils/intentRouter'
import type { Scenario } from '../src/types'

const scenario = {
  clientReplies: ['…'],
  intentReplies: { greeting: 'ok' },
  fallbackReply: 'fallback',
} as unknown as Scenario

const cases: Array<[string, RegExp]> = [
  [
    'Кто ведёт запись — журнал / Excel / WhatsApp?',
    /журнал|excel|whatsapp|тетрад|бумаг/i,
  ],
  [
    'Бывает, что заявки теряются или не перезванивают?',
    /заявк|перезвон|теря|потер|недозвон|висят/i,
  ],
  [
    'Пациенты возвращаются на гигиену сами или обзвон руками?',
    /гигиен|обзвон|возврат|повторн|напоминан/i,
  ],
  [
    'Сколько примерно пустых окон в неделю?',
    /окон|пуст|расписан|после обеда/i,
  ],
]

let fail = 0
for (const [q, re] of cases) {
  const hits = Array.from({ length: 8 }, () =>
    routeSmartReply(q, 2, scenario, [], 'marina', [
      { role: 'manager', text: q },
    ]).reply,
  )
  const ok = hits.some((r) => re.test(r))
  if (!ok) fail++
  console.log((ok ? 'OK  ' : 'FAIL') + ' «' + q.slice(0, 42) + '…»')
  console.log('   → ' + hits[0])
}
process.exit(fail ? 1 : 0)
