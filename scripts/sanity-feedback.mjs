import { analyzeRoleplayFeedback } from '../src/services/feedbackEngine.ts'

const messages = [
  'Марина Викторовна, добрый день! Меня зовут Тихон, я из ДентаCRM. Удобно пару минут по автоматизации записи?',
  'Если считать потери от неявок, у похожих клиник выходит порядка 50–100 тыс. рублей в месяц.',
  'Подписка обычно выходит 3000–5000 рублей в месяц.',
  'Давайте демо завтра в 11:00 или в 15:00 — удобно?',
]

const { feedback } = analyzeRoleplayFeedback({ managerMessages: messages })

console.log('=== mistakes ===')
for (const m of feedback.mistakes) {
  console.log(`${m.stageId} | ${m.managerQuote.slice(0, 80)}`)
}
console.log('=== successes ===')
for (const s of feedback.successes) {
  console.log(`${s.stageId} | ${s.managerQuote.slice(0, 80)}`)
}

const mistakeQuotes = new Set(feedback.mistakes.map((m) => m.managerQuote))
const successQuotes = new Set(feedback.successes.map((s) => s.managerQuote))
const overlap = [...mistakeQuotes].filter((q) => successQuotes.has(q))

console.log('\n=== checks ===')
console.log(
  'same quote not in both:',
  overlap.length === 0 ? 'PASS' : `FAIL ${JSON.stringify(overlap)}`,
)

const closingSuccess = feedback.successes.find((s) => s.stageId === 'closing')
const closeQ = closingSuccess?.managerQuote ?? ''
const mentionsDemoOrTime = /(демо|завтра|11|15|:)/i.test(closeQ)
const onlyPrice = /3000|5000|цен/i.test(closeQ) && !mentionsDemoOrTime
console.log('closing success quote:', closeQ.slice(0, 120))
console.log(
  'closing mentions demo/time not only price:',
  closingSuccess && mentionsDemoOrTime && !onlyPrice ? 'PASS' : 'FAIL',
)

const objectionsScore =
  feedback.stageScores.find((s) => s.stageId === 'objections')?.score ?? 10
const objectionsLow = objectionsScore < 6
const priceBare = messages.some(
  (m) => /3000|5000/.test(m) && !/50.?100|потер|окуп/i.test(m),
)
const objectionsMistake = feedback.mistakes.find(
  (m) =>
    m.stageId === 'objections' && /3000|5000|подписк|цен/i.test(m.managerQuote),
)
console.log('objections score:', objectionsScore)
console.log('price bare:', priceBare)
console.log(
  'objections mistake for price:',
  objectionsMistake
    ? `PASS (${objectionsMistake.managerQuote.slice(0, 60)})`
    : objectionsLow || priceBare
      ? 'FAIL'
      : 'N/A',
)
console.log('total:', feedback.totalScore, feedback.verdict)

const fail =
  overlap.length > 0 ||
  !(closingSuccess && mentionsDemoOrTime && !onlyPrice) ||
  ((objectionsLow || priceBare) && !objectionsMistake)
process.exit(fail ? 1 : 0)
