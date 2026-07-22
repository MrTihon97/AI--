import { routeSmartReply } from '../src/utils/intentRouter'

const s = {
  clientReplies: ['x'],
  intentReplies: { greeting: 'x' },
  fallbackReply: 'f',
} as any

const cases: Array<[string, string, RegExp]> = [
  ['artem', 'пошел нахер', /грубост|хамств|трубк|до свидания|оскорб|тоне/i],
  ['artem', 'Чем вы лучше Медодс? У нас 1С и Манго', /медодс|1с|манго|дифференциал|лучше/i],
  ['artem', 'Без партнёра не пойдём на демо', /партн|one-pager|shortlist|совет/i],
  ['marina', 'удобно минуту?', /слушаю|минута|коротко|по делу|говорите/i],
]

let fail = 0
for (const [client, q, re] of cases) {
  const r = routeSmartReply(q, 3, s, [], client, [
    { role: 'manager', text: q },
  ]).reply
  const ok = re.test(r)
  if (!ok) fail++
  console.log(`${ok ? 'OK  ' : 'FAIL'} [${client}] ${q} → ${r}`)
}
process.exit(fail ? 1 : 0)
