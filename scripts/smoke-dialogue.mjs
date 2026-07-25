import { runDialogueTurn, openingReply, initialContext } from '../src/dialogue/engine.ts'
import { classifyIntent } from '../src/dialogue/nlu.ts'
import { isNonsenseSpam } from '../src/services/intentMatcher.ts'
import { fillGender, enforceVoiceGender } from '../src/dialogue/gender.ts'
import {
  resolveGlobalSessionGuards,
  resolveOffTopicGuard,
  OFFTOPIC_TERMINATE_REPLY,
} from '../src/services/roleplayApi.ts'
import { isOffTopicMessage } from '../src/services/offTopicDetect.ts'

function turn(text, clientId, state, used) {
  const r = runDialogueTurn({
    userText: text,
    clientId,
    dialogueState: state,
    usedClientReplies: used,
  })
  used.push(r.reply)
  console.log(`[${r.stage}] ${r.policyId}`)
  console.log(`  «${text}»`)
  console.log(`  → ${r.reply}`)
  console.log(
    `  mood t=${r.dialogueState.mood.trust.toFixed(1)} irr=${r.dialogueState.mood.irritation.toFixed(1)}`,
  )
  return r.dialogueState
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('OK:', msg)
  }
}

console.log('=== guards ===')
assert(!isNonsenseSpam('Привет'), 'Привет не nonsense')
assert(!isNonsenseSpam('алло'), 'алло не nonsense')
assert(isNonsenseSpam('аааааааааааааааа'), 'aaaa = nonsense')
assert(classifyIntent('привет', 'intro').intentId === 'greeting', 'привет → greeting')
assert(classifyIntent('алло', 'intro').intentId === 'greeting', 'алло → greeting')

console.log('\n=== intro realism ===')
const open = openingReply('marina')
console.log('opening:', open.reply, '|', open.policyId)
assert(open.policyId === 'beat:intro_open', 'opening uses intro_open beat')
assert(!/пациент через|девять девять|9900/i.test(open.reply), 'opening без impatient/price junk')

let state = open.dialogueState
const used = [open.reply]

{
  const r = runDialogueTurn({
    userText: 'Привет',
    clientId: 'marina',
    dialogueState: state,
    usedClientReplies: used,
  })
  console.log('hello:', r.policyId, '→', r.reply)
  assert(
    r.policyId === 'beat:intro_hello' || r.policyId === 'beat:line_ping',
    'Привет → soft hello/ping beat',
  )
  assert(!/пациент через|Слышно\?|говорите по делу/i.test(r.reply), 'Привет без cold/nonsense')
  state = r.dialogueState
  used.push(r.reply)
}

{
  const r = runDialogueTurn({
    userText: 'Сколько заявок теряется?',
    clientId: 'marina',
    dialogueState: state,
    usedClientReplies: used,
  })
  console.log('contactGate:', r.policyId, '→', r.reply)
  assert(r.policyId === 'beat:contact_gate', 'без представления → contact_gate')
  assert(
    /кто|компани|не\s+знаком|представ|откуда\s+звон/i.test(r.reply),
    'contact_gate требует идентификацию',
  )
  assert(!/стыдно|ирина\s+не\s+перезвон|потери\s+есть/i.test(r.reply), 'не раскрывает боли')
  assert(
    r.dialogueState.stage === 'intro',
    'contact_gate держит stage=intro',
  )
  state = r.dialogueState
  used.push(r.reply)
}

{
  // Absolute gate: «Сколько кресел?» без intro ≠ discovery/price
  const chairs = runDialogueTurn({
    userText: 'Сколько у вас кресел?',
    clientId: 'marina',
    dialogueState: state,
    usedClientReplies: used,
  })
  console.log('chairsGate:', chairs.policyId, '→', chairs.reply)
  assert(
    chairs.policyId === 'beat:contact_gate',
    'кресла без intro → contact_gate',
  )
  assert(
    /кто|компани|знаком|представ|откуда/i.test(chairs.reply),
    'кресла → pushback знакомства',
  )
  assert(
    !/подписк|бюджет|прайс|ирина|whatsapp|тонем/i.test(chairs.reply),
    'кресла без intro ≠ price/pain leak',
  )
  assert(chairs.dialogueState.stage === 'intro', 'кресла: stage остаётся intro')
  assert(
    chairs.dialogueState.slots.hasIntroduced !== true,
    'кресла ≠ hasIntroduced',
  )
  state = chairs.dialogueState
  used.push(chairs.reply)
}

{
  // Игнор «Вы из какой компании?» → insistence, не clinic data
  const ignore = runDialogueTurn({
    userText: 'Сколько неявок у вас в неделю из WhatsApp?',
    clientId: 'marina',
    dialogueState: state,
    usedClientReplies: used,
  })
  console.log('ignoreGate:', ignore.policyId, '→', ignore.reply)
  assert(ignore.policyId === 'beat:contact_gate', 'игнор → contact_gate снова')
  assert(
    /вс[её]\s+ещ[её]\s+не\s+услышал|представьте?сь|иначе\s+диалога/i.test(
      ignore.reply,
    ),
    'текст insistence',
  )
  assert(
    ignore.dialogueState.slots.hasIntroduced !== true &&
      ignore.dialogueState.slots.contactEstablished !== true,
    'игнор ≠ hasIntroduced',
  )
  assert(
    !/ирина|стыдно|тонем|ручную/i.test(ignore.reply),
    'игнор без clinic data',
  )
  state = ignore.dialogueState
  used.push(ignore.reply)
}

{
  const r = runDialogueTurn({
    userText:
      'Это Тихон, компания ДентаCRM. Подскажите, сколько заявок и повторных визитов теряется из‑за ручного ввода и забытых напоминаний?',
    clientId: 'marina',
    dialogueState: state,
    usedClientReplies: used,
  })
  console.log('discovery:', r.policyId, '→', r.reply)
  assert(
    r.policyId === 'beat:discovery_pain' ||
      r.policyId === 'beat:discovery_answer',
    'discovery beat',
  )
  assert(
    /ирина|whatsapp|журнал|запис|систем|ручн|excel|мессенджер|телефон/i.test(
      r.reply,
    ),
    'discovery отвечает по теме',
  )
  assert(r.reply.split(/[.!?]/).filter(Boolean).length >= 1, 'discovery = ответ')
  assert(r.dialogueState.slots.contactEstablished === true, 'после представления contact ok')
  assert(r.dialogueState.slots.hasIntroduced === true, 'hasIntroduced true')
  // После gate — сдержанно, без прыжка в уязвимость и без мета-фраз / «допустим»
  assert(
    !/тонем|стыдно,\s*но\s+так\s+живём|зацепило|фиксирую:\s*речь|тема\s+\S+\s+близкая|если\s+говорить\s+именно\s+про|\bдопустим\b|\bположим\b/i.test(
      r.reply,
    ),
    'после gate: reserved, без meta/deep vuln',
  )
  assert(
    /whatsapp|журнал|запис|ирина|ручн|мессенджер|телефон|контур/i.test(
      r.reply,
    ),
    'после gate: прямой ответ по процессу',
  )
  state = r.dialogueState
  used.push(r.reply)
}

console.log('\n=== multi-intent ===')
console.log(
  'intro:',
  classifyIntent('Сколько стоит и давайте демо в Zoom завтра', 'intro').intentId,
)
console.log(
  'closing:',
  classifyIntent('Сколько стоит и давайте демо в Zoom завтра', 'closing').intentId,
)

console.log('\n=== dialogue path ===')
state = initialContext('marina')
used.length = 0
state = turn('Добрый день, удобно минуту?', 'marina', state, used)
{
  // Без представления discovery → gate, не clinic data
  const r = runDialogueTurn({
    userText: 'Сколько заявок теряется из WhatsApp?',
    clientId: 'marina',
    dialogueState: state,
    usedClientReplies: used,
  })
  used.push(r.reply)
  state = r.dialogueState
  console.log(`[${r.stage}] ${r.policyId}`)
  console.log(`  → ${r.reply}`)
  assert(r.policyId === 'beat:contact_gate', 'discovery без intro → contact_gate')
  assert(
    !/ирина|стыдно|тонем|whatsapp у нас/i.test(r.reply),
    'gate без clinic data',
  )
}
{
  // Игнор gate → insistence, step не в discovery pain
  const r = runDialogueTurn({
    userText: 'Ну так сколько заявок теряется?',
    clientId: 'marina',
    dialogueState: state,
    usedClientReplies: used,
  })
  used.push(r.reply)
  state = r.dialogueState
  console.log('insist', r.policyId, r.reply)
  assert(r.policyId === 'beat:contact_gate', 'игнор gate → снова contact_gate')
  assert(
    /вс[её]\s+ещ[её]\s+не\s+услышал|представьте?сь|иначе\s+диалога/i.test(
      r.reply,
    ),
    'insistence про представление',
  )
  assert(
    r.dialogueState.slots.hasIntroduced !== true &&
      r.dialogueState.slots.contactEstablished !== true,
    'hasIntroduced всё ещё false',
  )
  assert(!/ирина|стыдно|тонем/i.test(r.reply), 'insistence без clinic data')
}
state = turn(
  'Это Тихон, компания ДентаCRM. Сколько заявок теряется из WhatsApp?',
  'marina',
  state,
  used,
)
state = turn('По подписке выходит около 15–25 тыс. в месяц', 'marina', state, used)
{
  const last = used.at(-1) ?? ''
  assert(!/9900|девять\s*девять/i.test(last), 'price stated без 9900')
  // policyId проверяем отдельным ходом нельзя — смотрим через свежий run
}
{
  const probeState = initialContext('marina')
  probeState.slots.painFound = true
  probeState.stage = 'discovery'
  const r = runDialogueTurn({
    userText: 'По подписке выходит около 15–25 тыс. в месяц',
    clientId: 'marina',
    dialogueState: probeState,
    usedClientReplies: [],
  })
  console.log('price_stated probe:', r.policyId, '→', r.reply)
  assert(r.policyId === 'beat:price_stated', 'названная цена → price_stated beat')
  assert(!/9900|девять\s*девять/i.test(r.reply), 'probe без 9900')
}
state = turn('Давайте созвонимся на 10 минут завтра в Zoom', 'marina', state, used)

console.log('\n=== ask rhythm ===')
{
  let s = openingReply('marina').dialogueState
  const u = []
  const a = runDialogueTurn({
    userText: 'Сколько заявок теряется?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: u,
  })
  u.push(a.reply)
  s = a.dialogueState
  console.log('d1', a.policyId, a.reply)
  assert(a.policyId === 'beat:contact_gate', 'первый diagnostic без ID → contact_gate')
  assert(!/стыдно|ирина\s+не\s+перезвон/i.test(a.reply), 'gate без pain disclosure')

  const a2 = runDialogueTurn({
    userText: 'Это Тихон, ДентаCRM. Сколько заявок теряется?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: u,
  })
  u.push(a2.reply)
  s = a2.dialogueState
  console.log('d1b', a2.policyId, a2.reply)
  assert(
    a2.policyId === 'beat:discovery_answer' ||
      a2.policyId === 'beat:discovery_pain',
    'после ID: discovery',
  )
  assert(
    !/зацепило|фиксирую:\s*речь|если\s+говорить\s+именно\s+про/i.test(a2.reply),
    'без meta-listening фраз',
  )
  assert(
    !/тонем|стыдно,\s*но\s+так\s+живём/i.test(a2.reply),
    'после gate без deep vuln',
  )
  assert(
    !/\bдопустим\b|\bположим\b/i.test(a2.reply),
    'после gate без скептического филлера',
  )

  // CHOICE_QUESTION: выбрать вариант, без «допустим» / «тонем»
  const choice = runDialogueTurn({
    userText:
      'Это Тихон, ДентаCRM. Кто ведёт запись — журнал / Excel / WhatsApp?',
    clientId: 'marina',
    dialogueState: initialContext('marina'),
    usedClientReplies: [],
  })
  // если gate — сначала ID уже в тексте, должен сразу discovery
  console.log('choiceQ', choice.policyId, choice.reply)
  assert(
    choice.policyId === 'beat:discovery_answer' ||
      choice.policyId === 'beat:discovery_pain' ||
      choice.policyId === 'beat:intro_substance',
    'choice Q → discovery',
  )
  assert(
    /whatsapp|журнал|excel|телефон|мессенджер|администратор/i.test(choice.reply),
    'choice Q → выбран способ записи',
  )
  assert(
    !/\b(ну,?\s*)?допустим\b|\bположим\b|тонем|без\s+системы\s+реально/i.test(
      choice.reply,
    ),
    'choice Q без допустим/тонем',
  )

  const b = runDialogueTurn({
    userText: 'А из‑за ручного ввода и забытых напоминаний?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: u,
  })
  console.log('d2', b.policyId, b.reply)
  assert(
    b.policyId === 'beat:discovery_answer' ||
      b.policyId === 'beat:persona_pushback' ||
      b.dialogueState.lastReplyHadAsk === false,
    'второй discovery подряд — без вопроса',
  )
  assert(
    b.policyId === 'beat:persona_pushback' || !/\?/.test(b.reply),
    'второй discovery текст без ?',
  )
}

{
  const s = initialContext('marina')
  s.slots.demoOffered = true
  s.slots.closingAttempts = 1
  s.slots.personaPushbackShown = true
  s.slots.hasHandledObjection = true
  s.stage = 'closing'
  s.lastReplyHadAsk = true
  const soft = runDialogueTurn({
    userText: 'ок',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('confirm soft', soft.policyId, soft.reply)
  assert(soft.policyId === 'beat:closing_need_slot', 'ок после демо без слота → need_slot')
  assert(
    /когда\s+именно|день\s+и\s+время/i.test(soft.reply),
    'требует день и время',
  )
  assert(soft.dialogueState.sessionStatus !== 'completed', 'soft ок ≠ SESSION_COMPLETE')

  const r = runDialogueTurn({
    userText: 'Завтра в 11:00',
    clientId: 'marina',
    dialogueState: soft.dialogueState,
    usedClientReplies: [soft.reply],
  })
  console.log('confirm', r.policyId, r.reply)
  assert(
    r.policyId === 'beat:closing_confirm' || r.policyId === 'beat:closing_ok',
    'день+время → confirm/ok',
  )
  assert(r.dialogueState.sessionStatus === 'completed', 'день+время → SESSION_COMPLETE')
}

{
  // Toxicity: 1-е → warning, 2-е → TERMINATED_ETIQUETTE
  let s = initialContext('marina')
  const w1 = runDialogueTurn({
    userText: 'мудак',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('tox1', w1.policyId, w1.reply)
  assert(w1.policyId === 'toxicity:warning', 'мат #1 → warning')
  assert(w1.dialogueState.warningCount === 1, 'warningCount=1')
  assert(w1.dialogueState.sessionStatus === 'warning', 'status=warning')
  assert(
    /рамки делового общения|хамство/i.test(w1.reply),
    'warning текст про рамки',
  )
  assert(/вынуждена/i.test(w1.reply), 'Марина — женский род в warning')
  assert(w1.dialogueState.sessionStatus !== 'terminated_etiquette', '1-й ≠ ban')

  const w2 = runDialogueTurn({
    userText: 'пошёл нахуй',
    clientId: 'marina',
    dialogueState: w1.dialogueState,
    usedClientReplies: [w1.reply],
  })
  console.log('tox2', w2.policyId, w2.reply)
  assert(w2.policyId === 'toxicity:terminate', 'мат #2 → terminate')
  assert(w2.dialogueState.warningCount === 2, 'warningCount=2')
  assert(
    w2.dialogueState.sessionStatus === 'terminated_etiquette',
    'status=TERMINATED_ETIQUETTE',
  )
  assert(
    w2.dialogueState.failReason === 'terminated_etiquette',
    'failReason terminated_etiquette',
  )
  assert(
    /Вы адекватны\? Я завершаю этот разговор/i.test(w2.reply),
    'terminate текст',
  )

  // Повтор после terminate — только terminate-реплика
  const w3 = runDialogueTurn({
    userText: 'алло',
    clientId: 'marina',
    dialogueState: w2.dialogueState,
    usedClientReplies: [w2.reply],
  })
  assert(w3.policyId === 'toxicity:terminated', 'после fail → terminated guard')
  assert(
    w3.dialogueState.sessionStatus === 'terminated_etiquette',
    'остаётся terminated_etiquette',
  )
}

{
  // Артём: тот же 2-strike guard (не script replies)
  let s = initialContext('artem')
  const a1 = runDialogueTurn({
    userText: 'ты идиот',
    clientId: 'artem',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('artemTox1', a1.policyId, a1.reply)
  assert(a1.policyId === 'toxicity:warning', 'Артём мат #1 → warning')
  assert(/вынужден буду/i.test(a1.reply), 'Артём — мужской род в warning')
  assert(
    !/1С|Медодс|филиал|дашборд/i.test(a1.reply),
    'Артём мат #1 ≠ script reply',
  )

  const a2 = runDialogueTurn({
    userText: 'пошёл нахуй',
    clientId: 'artem',
    dialogueState: a1.dialogueState,
    usedClientReplies: [a1.reply],
  })
  assert(a2.policyId === 'toxicity:terminate', 'Артём мат #2 → terminate')
  assert(
    a2.dialogueState.sessionStatus === 'terminated_etiquette',
    'Артём → TERMINATED_ETIQUETTE',
  )
  assert(
    /Вы адекватны\? Я завершаю этот разговор/i.test(a2.reply),
    'Артём terminate текст',
  )
}

{
  // Off-topic: 3 подряд → TERMINATED_OFFTOPIC (все персоны)
  assert(isOffTopicMessage('погода сегодня супер'), 'погода = offtopic')
  assert(isOffTopicMessage('мм'), 'короткое мм = offtopic')
  assert(
    !isOffTopicMessage('Как у вас с заявками в WhatsApp?'),
    'sales keywords ≠ offtopic',
  )
  assert(
    !isOffTopicMessage('Здравствуйте, меня зовут Тихон, компания ДентаCRM'),
    'intro ≠ offtopic',
  )

  let s = initialContext('marina')
  const o1 = resolveOffTopicGuard({
    userText: 'как дела вообще',
    clientId: 'marina',
    dialogueState: s,
  })
  assert(!o1.result && o1.offTopicCount === 1, 'offtopic #1 → count=1, no ban')
  s = {
    ...s,
    slots: { ...s.slots, offTopicCount: o1.offTopicCount },
  }

  const o2 = resolveOffTopicGuard({
    userText: 'футбол вчера смотрели кстати',
    clientId: 'marina',
    dialogueState: s,
  })
  assert(!o2.result && o2.offTopicCount === 2, 'offtopic #2 → count=2, no ban')
  s = {
    ...s,
    slots: { ...s.slots, offTopicCount: o2.offTopicCount },
  }

  const o3 = resolveOffTopicGuard({
    userText: 'анекдот расскажите',
    clientId: 'marina',
    dialogueState: s,
  })
  assert(o3.result, 'offtopic #3 → terminate result')
  assert(o3.offTopicCount === 3, 'offtopic count=3')
  assert(
    o3.result.dialogueState.sessionStatus === 'terminated_offtopic',
    'status TERMINATED_OFFTOPIC',
  )
  assert(
    o3.result.dialogueState.failReason === 'terminated_offtopic',
    'failReason terminated_offtopic',
  )
  assert(
    o3.result.reply === OFFTOPIC_TERMINATE_REPLY,
    'offtopic terminate текст',
  )
  assert(/предметного разговора не получается/i.test(o3.result.reply), 'фраза про предметный разговор')

  // sales сбрасывает streak
  let s2 = {
    ...initialContext('artem'),
    slots: { ...initialContext('artem').slots, offTopicCount: 2 },
  }
  const reset = resolveOffTopicGuard({
    userText: 'Сколько теряете заявок без CRM?',
    clientId: 'artem',
    dialogueState: s2,
  })
  assert(!reset.result && reset.offTopicCount === 0, 'sales → offTopicCount=0')

  // Артём: 3 offtopic → ban
  let sa = initialContext('artem')
  for (let i = 1; i <= 2; i++) {
    const g = resolveOffTopicGuard({
      userText: `кино посоветуйте ${i}`,
      clientId: 'artem',
      dialogueState: sa,
    })
    assert(!g.result && g.offTopicCount === i, `Артём offtopic #${i}`)
    sa = {
      ...sa,
      slots: { ...sa.slots, offTopicCount: g.offTopicCount },
    }
  }
  const aBan = resolveOffTopicGuard({
    userText: 'что слышно по жизни',
    clientId: 'artem',
    dialogueState: sa,
  })
  assert(
    aBan.result?.dialogueState.sessionStatus === 'terminated_offtopic',
    'Артём → TERMINATED_OFFTOPIC',
  )

  // После ban engine отдаёт offtopic terminated
  const locked = runDialogueTurn({
    userText: 'алло',
    clientId: 'artem',
    dialogueState: aBan.result.dialogueState,
    usedClientReplies: [aBan.result.reply],
  })
  assert(locked.policyId === 'offtopic:terminated', 'после offtopic fail → guard')
  assert(
    /предметного разговора не получается/i.test(locked.reply),
    'locked reply offtopic',
  )
}

{
  // resolveGlobalSessionGuards: один пайплайн для marina и artem
  for (const clientId of ['marina', 'artem']) {
    const hist = (texts) =>
      texts.map((text, i) => ({
        role: 'manager',
        text,
        id: `${clientId}-${i}`,
      }))

    const warn = resolveGlobalSessionGuards({
      userText: 'ты дура',
      clientId,
      historyMessages: hist(['ты дура']),
      dialogueState: initialContext(clientId),
    })
    assert(warn.kind === 'block', `${clientId}: мат #1 → block`)
    assert(
      warn.result?.policyId === 'toxicity:warning',
      `${clientId}: мат #1 → warning (не persona)`,
    )

    const ban = resolveGlobalSessionGuards({
      userText: 'пошёл нахуй',
      clientId,
      historyMessages: hist(['ты дура', 'пошёл нахуй']),
      dialogueState: warn.result.dialogueState,
    })
    assert(ban.kind === 'block', `${clientId}: мат #2 → block`)
    assert(
      ban.result?.dialogueState.sessionStatus === 'terminated_etiquette',
      `${clientId}: мат #2 → TERMINATED_ETIQUETTE`,
    )

    let offState = initialContext(clientId)
    for (let i = 1; i <= 2; i++) {
      const p = resolveGlobalSessionGuards({
        userText: `анекдот номер ${i}`,
        clientId,
        historyMessages: hist([`анекдот номер ${i}`]),
        dialogueState: offState,
      })
      assert(p.kind === 'pass', `${clientId}: offtopic #${i} → pass к персоне`)
      assert(p.offTopicCount === i, `${clientId}: offtopic count=${i}`)
      offState = {
        ...offState,
        slots: { ...offState.slots, offTopicCount: p.offTopicCount },
      }
    }
    const offBan = resolveGlobalSessionGuards({
      userText: 'погода супер вообще',
      clientId,
      historyMessages: hist(['погода супер вообще']),
      dialogueState: offState,
    })
    assert(offBan.kind === 'block', `${clientId}: offtopic #3 → block`)
    assert(
      offBan.result?.dialogueState.sessionStatus === 'terminated_offtopic',
      `${clientId}: offtopic #3 → TERMINATED_OFFTOPIC`,
    )

    const sales = resolveGlobalSessionGuards({
      userText: 'Сколько заявок теряется из WhatsApp?',
      clientId,
      historyMessages: hist(['Сколько заявок теряется из WhatsApp?']),
      dialogueState: initialContext(clientId),
    })
    assert(sales.kind === 'pass', `${clientId}: sales → pass к персоне`)
    assert(sales.offTopicCount === 0, `${clientId}: sales offTopicCount=0`)
  }
}

{
  // Расширенный детект: «дура» → warning; «в жопу» #2 → ban
  let s = initialContext('marina')
  const d1 = runDialogueTurn({
    userText: 'ты дура',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  assert(d1.policyId === 'toxicity:warning', '«дура» → warning')
  assert(!/общие тезисы|стоп\./i.test(d1.reply), 'не generic pace beat')
  assert(d1.dialogueState.sessionStatus === 'warning', 'status=warning')

  const d2 = runDialogueTurn({
    userText: 'иди в жопу',
    clientId: 'marina',
    dialogueState: d1.dialogueState,
    usedClientReplies: [d1.reply],
  })
  assert(d2.policyId === 'toxicity:terminate', '«в жопу» #2 → terminate')
  assert(
    d2.dialogueState.sessionStatus === 'terminated_etiquette',
    'terminate status',
  )
}


{
  // pacing: 2 монолога без ? → interrupt
  let s = initialContext('marina')
  s.managerMonoStreak = 1
  const r = runDialogueTurn({
    userText: 'Наша CRM экономит время администратора и вообще всё автоматизирует',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('pace', r.policyId, r.reply)
  assert(r.policyId === 'beat:pace_interrupt', '2 монолога → pace_interrupt')
  assert(/конкретный вопрос|цифры/i.test(r.reply), 'pace текст про вопрос/цифры')
}

{
  // timing: intro ~1s, pitch/objection reading
  const open = openingReply('marina')
  assert(open.typingDelayMs === 1000, 'intro delay 1s')
  assert(open.clientReading === false, 'intro не reading')
}

{
  // длинный интро с темой — не «по какому поводу звоните»
  const longIntro =
    'Марина Викторовна, добрый день! Меня зовут Тихон, компания X. Звоню по поводу автоматизации записи пациентов и снижения отмен. Подскажите, есть буквально 3 минуты задать пару вопросов и понять, будем ли мы вам полезны?'
  const r = runDialogueTurn({
    userText: longIntro,
    clientId: 'marina',
    dialogueState: openingReply('marina').dialogueState,
    usedClientReplies: [],
  })
  console.log('longIntro', r.policyId, r.reply)
  assert(
    r.policyId === 'beat:intro_substance' ||
      r.policyId === 'beat:pitch' ||
      r.policyId === 'beat:pitch_followup' ||
      r.policyId === 'beat:discovery_pain' ||
      r.policyId === 'beat:discovery_answer',
    'длинный интро → substance/pitch/discovery',
  )
  assert(!/по какому поводу звоните/i.test(r.reply), 'не переспрашивает повод')
  assert(
    /запис|заявк|отмен|услыш|понял|тем|боль|полез|минут|неявк|админ|потер|слушаю|ирина/i.test(
      r.reply,
    ),
    'ответ цепляется за тему интро',
  )
}

{
  // closing: цена + слот времени → closing_ok, не price_stated
  // (после hard-gate: уже был pushback / попытка закрытия)
  let s = initialContext('marina')
  s.slots.painFound = true
  s.slots.priceDiscussed = true
  s.slots.personaPushbackShown = true
  s.slots.hasHandledObjection = true
  s.slots.closingAttempts = 1
  s.stage = 'objection'
  const r = runDialogueTurn({
    userText:
      'Подписка от 3000 до 5000 рублей в месяц. Давайте завтра на 10 минут в Zoom в 11:00 или 15:00?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('closeSlot', r.policyId, r.reply)
  assert(r.policyId === 'beat:closing_ok', 'цена+слот → closing_ok')
  assert(!/сколько.*стоит|вилка под два|что входит в эту сумму/i.test(r.reply), 'не переспрашивает цену')
  assert(
    /whatsapp|слот|zoom|демо|11|15|договорил|жду/i.test(r.reply),
    'принимает слот/демо',
  )
  assert(r.dialogueState.sessionStatus === 'completed', 'цена+слот → SESSION_COMPLETE')
}

{
  // 10–20% потерь — НЕ price_stated
  let s = initialContext('marina')
  s.slots.greeted = true
  s.slots.contactEstablished = true
  s.stage = 'discovery'
  const r = runDialogueTurn({
    userText:
      'В среднем у клиник аналогичного формата теряется от 10 до 20% записей. Подскажите, как у вас сейчас администраторы напоминают о приёме?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('lossPct', r.policyId, r.reply)
  assert(r.policyId !== 'beat:price_stated', '10-20% не price_stated')
  assert(!/про цену|цифру приняла|цифру услышала/i.test(r.reply), 'нет ложной цены в ack')
}

{
  // демо без ложного «про цену» (после pushback-gate)
  let s = initialContext('marina')
  s.slots.painFound = true
  s.slots.priceDiscussed = true
  s.slots.personaPushbackShown = true
  s.slots.hasHandledObjection = true
  s.slots.closingAttempts = 1
  s.stage = 'objection'
  const r = runDialogueTurn({
    userText:
      'Давайте завтра на 10 минут в Zoom — покажу окупаемость на ваших цифрах. Удобно в 11:00 или 15:00?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('demoNoPrice', r.policyId, r.reply)
  assert(r.policyId === 'beat:closing_ok', 'демо → closing_ok')
  assert(!/про цену|если говорить именно про цену/i.test(r.reply), 'closing без price-prefix')
  assert(r.dialogueState.sessionStatus === 'completed', 'демо+слот → SESSION_COMPLETE')
}

{
  // Soft WhatsApp / «когда удобно» — не SESSION_COMPLETE
  let s = initialContext('marina')
  s.slots.painFound = true
  s.slots.priceDiscussed = true
  s.slots.personaPushbackShown = true
  s.slots.hasHandledObjection = true
  s.slots.closingAttempts = 1
  s.stage = 'objection'
  const soft = runDialogueTurn({
    userText: 'Договорились. Напишите в WhatsApp, когда удобно',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('fuzzySoftClose', soft.policyId, soft.reply)
  assert(soft.policyId === 'beat:closing_need_slot', 'soft WhatsApp → need_slot')
  assert(
    /Хорошо, а когда именно созвонимся\? Назовите день и время/i.test(soft.reply),
    'persona требует день и время',
  )
  assert(soft.dialogueState.sessionStatus !== 'completed', 'soft close ≠ SESSION_COMPLETE')

  const locked = runDialogueTurn({
    userText: 'Давайте завтра в 11:00 Zoom на 10 минут',
    clientId: 'marina',
    dialogueState: soft.dialogueState,
    usedClientReplies: [soft.reply],
  })
  console.log('fuzzyThenSlot', locked.policyId, locked.reply)
  assert(
    locked.policyId === 'beat:closing_ok' || locked.policyId === 'beat:closing_confirm',
    'после soft → день+время → AGREED',
  )
  assert(locked.dialogueState.sessionStatus === 'completed', 'день+время → SESSION_COMPLETE')
}

{
  // Артём: вопрос про конверсию не должен уходить в «обучение персонала»
  // и не должен клеить шаблоны финансовых потерь («Про потери…», «Ирина не перезванивает»)
  let s = initialContext('artem')
  s.slots.greeted = true
  s.slots.contactEstablished = true
  s.stage = 'discovery'
  const conversionQ =
    'Артём, добрый день! Меня зовут Тихон, компания X. Звоню по поводу централизованного контроля работы администраторов и сквозной аналитики по всем 4 филиалам сети. Подскажите, есть буквально пару минут обсудить, как сейчас отслеживаете конверсию из звонка в запись по клиникам?'
  const r = runDialogueTurn({
    userText: conversionQ,
    clientId: 'artem',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('artemConversion', r.policyId, r.reply)
  assert(
    r.policyId === 'beat:discovery_pain' ||
      r.policyId === 'beat:discovery_answer' ||
      r.policyId === 'beat:intro_substance' ||
      r.policyId === 'beat:pitch',
    'интро+вопрос → discovery/substance',
  )
  assert(!/обучен|скрытая стоимость|пользуется системой/i.test(r.reply), 'не прыгает в admin/обучение')
  assert(
    /конверси|филиал|звонок|запис|аналитик|сводн|отч[её]т|дашборд|управляющ|журнал/i.test(
      r.reply,
    ),
    'отвечает в теме конверсии/сети',
  )
  assert(
    !/про\s+потери|если\s+про\s+потери|ирина\s+не\s+перезванивает/i.test(r.reply),
    'конверсия ≠ шаблон финансовых потерь',
  )
  assert(
    !/что\s+да[её]те|что\s+даете|для\s+контроля\s+недозвон/i.test(r.reply),
    'не инвертирует роль встречным feature-ask',
  )
  assert(
    !/\b(поняла|услышала|приняла|расслышала|готова)\b/i.test(r.reply),
    'Артём без женского рода',
  )

  // Марина: тот же ASK_CONVERSION_METRICS — без Irina/потери templates
  let sm = initialContext('marina')
  sm.slots.greeted = true
  sm.slots.contactEstablished = true
  sm.stage = 'discovery'
  const rm = runDialogueTurn({
    userText:
      'Подскажите, как сейчас отслеживаете конверсию из звонка в запись по филиалам?',
    clientId: 'marina',
    dialogueState: sm,
    usedClientReplies: [],
  })
  console.log('marinaConversion', rm.policyId, rm.reply)
  assert(
    !/про\s+потери|если\s+про\s+потери|ирина\s+не\s+перезванивает/i.test(rm.reply),
    'marina: конверсия ≠ потери/Ирина',
  )
  assert(
    /конверси|сводн|отч[её]т|журнал|филиал|дашборд|управляющ|картин/i.test(rm.reply),
    'marina: ответ в рамке конверсии/свода',
  )
}

{
  // Gender placeholders: общие шаблоны не зашиты в женский род
  assert(fillGender('Про потери {понял}.', 'm') === 'Про потери понял.', 'fillGender m')
  assert(fillGender('Про потери {понял}.', 'f') === 'Про потери поняла.', 'fillGender f')
  assert(fillGender('{Услышал} про CRM.', 'm') === 'Услышал про CRM.', 'fillGender cap m')
  assert(
    enforceVoiceGender('Про потери поняла, давайте предметно.', 'm') ===
      'Про потери понял, давайте предметно.',
    'enforce m strips feminine',
  )
}

{
  // Потери в ₽ + вопрос про WhatsApp ≠ «про цену» / price_stated
  let s = initialContext('marina')
  s.slots.greeted = true
  s.slots.contactEstablished = true
  s.slots.painFound = true
  s.stage = 'closing'
  const r = runDialogueTurn({
    userText:
      'Если при чеке 2 500 ₽ клиника недополучает от 50 000 до 100 000 ₽ чистой выручки в месяц. А как Ирина сейчас напоминает записавшимся пациентам о визите — вручную через WhatsApp или звонит по базе?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('lossRubWhatsapp', r.policyId, r.reply)
  assert(r.policyId !== 'beat:price_stated', 'потери в ₽ ≠ price_stated')
  assert(!/про цену|ок, про цену/i.test(r.reply), 'нет ложного ack про цену')
  assert(
    /whatsapp|мессенджер|ирина|вручную|напомина/i.test(r.reply),
    'отвечает на вопрос про напоминания/WhatsApp',
  )
}

{
  // Короткое время без дня — не SESSION_COMPLETE; день+время — complete
  assert(!isNonsenseSpam('13:00'), '13:00 не nonsense')
  assert(!isNonsenseSpam('16:00?'), '16:00? не nonsense')

  let s = initialContext('marina')
  s.slots.painFound = true
  s.slots.demoOffered = true
  s.slots.closingAttempts = 1
  s.slots.personaPushbackShown = true
  s.slots.hasHandledObjection = true
  s.stage = 'closing'
  for (const time of ['13:00', '16:00?']) {
    const r = runDialogueTurn({
      userText: time,
      clientId: 'marina',
      dialogueState: s,
      usedClientReplies: [],
    })
    console.log('slotTime bare', time, r.policyId, r.reply)
    assert(r.policyId === 'beat:closing_need_slot', `${time} без дня → need_slot`)
    assert(
      /когда\s+именно|день\s+и\s+время/i.test(r.reply),
      `${time} требует день и время`,
    )
    assert(r.dialogueState.sessionStatus !== 'completed', `${time} ≠ SESSION_COMPLETE`)
  }

  for (const phrase of ['завтра в 13:00', 'завтра в 16:00']) {
    const r = runDialogueTurn({
      userText: phrase,
      clientId: 'marina',
      dialogueState: s,
      usedClientReplies: [],
    })
    console.log('slotTime', phrase, r.policyId, r.reply)
    assert(
      r.policyId === 'beat:closing_confirm' || r.policyId === 'beat:closing_ok',
      `${phrase} → closing_confirm/ok`,
    )
    assert(
      !/это мимо|связь нормальная|сформулируйте одним/i.test(r.reply),
      `${phrase} без nonsense fallback`,
    )
    assert(/13:00|16:00|записал|договорил/i.test(r.reply), `${phrase} эхо / записала`)
    assert(r.dialogueState.sessionStatus === 'completed', `${phrase} → SESSION_COMPLETE`)
  }
}

{
  // Hard gate: Zoom БЕЗ цифр → возражение по времени, НЕ «50 тысяч»
  let sBare = initialContext('marina')
  sBare.slots.greeted = true
  sBare.slots.contactEstablished = true
  sBare.slots.painFound = true
  sBare.slots.developedArgument = true
  sBare.stage = 'discovery'
  sBare.turn = 2
  assert(
    (sBare.mentionedFigures ?? []).length === 0,
    'новая сессия: mentionedFigures пуст',
  )
  const bareZoom = runDialogueTurn({
    userText:
      'Давайте созвонимся на 10 минут завтра в Zoom, удобно в 11:00 или 15:00?',
    clientId: 'marina',
    dialogueState: sBare,
    usedClientReplies: [],
  })
  console.log('marinaZoomNoFigs', bareZoom.policyId, bareZoom.reply)
  assert(
    bareZoom.policyId === 'beat:objection_busy' ||
      bareZoom.policyId === 'beat:objection_skepticism' ||
      bareZoom.policyId === 'beat:persona_pushback',
    'Zoom без цифр → objection/pushback',
  )
  assert(
    !/50\s*тысяч|50\s*000|100\s*тысяч|100\s*000|откуда\s+цифра\s+в\s+50/i.test(
      bareZoom.reply,
    ),
    'без цифр менеджера ≠ галлюцинация 50 тысяч',
  )
  assert(
    /zoom|при[её]м|пациент|некогда|минут|слот|суть|тезис|повеств/i.test(
      bareZoom.reply,
    ),
    'возражение про время/срочность, не про выдуманную сумму',
  )
}

{
  // Hard gate: первый Zoom у Марины — всегда pushback (даже с цифрами в той же реплике)
  let s = initialContext('marina')
  s.slots.greeted = true
  s.slots.contactEstablished = true
  s.slots.painFound = true
  s.slots.developedArgument = true
  s.stage = 'discovery'
  s.turn = 2
  const early = runDialogueTurn({
    userText:
      'По потерям 50–100 тыс. ₽. Давайте созвонимся на 10 минут завтра в Zoom, удобно в 11:00 или 15:00?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: [],
  })
  console.log('marinaEarlyDemo', early.policyId, early.reply)
  assert(
    early.policyId === 'beat:objection_busy' ||
      early.policyId === 'beat:objection_skepticism' ||
      early.policyId === 'beat:persona_pushback',
    '1-й Zoom → objection beat',
  )
  assert(early.policyId !== 'beat:closing_ok', '1-й Zoom ≠ closing_ok')
  assert(
    /zoom|рубль|50|при[её]м|цифр|пациент|некогда|тысяч/i.test(early.reply),
    'возражение по времени/цене в реплике',
  )
  assert(
    (early.dialogueState.mentionedFigures ?? []).some((f) => /50/.test(f)),
    'цифра 50 зафиксирована в session memory',
  )
  assert(
    early.dialogueState.slots.personaPushbackShown === true,
    'pushback отмечен',
  )
  assert(
    early.dialogueState.slots.hasHandledObjection !== true,
    'hasHandledObjection ещё false (менеджер не ответил на возражение)',
  )
  assert(
    (early.dialogueState.slots.closingAttempts ?? 0) >= 1,
    'closingAttempts инкремент после 1-го предложения',
  )

  // После ответа на возражение + повторный Zoom — AGREED
  const later = runDialogueTurn({
    userText:
      'Понял. Потеря ≈ 50–100 тыс. ₽/мес, подписка отбивается быстро. Давайте завтра 10 минут в Zoom — покажу на ваших цифрах, удобно в 11:00?',
    clientId: 'marina',
    dialogueState: early.dialogueState,
    usedClientReplies: [early.reply],
  })
  console.log('marinaDemoAfterValue', later.policyId, later.reply)
  assert(
    later.dialogueState.slots.hasHandledObjection === true,
    'после ответа → hasHandledObjection',
  )
  assert(later.policyId === 'beat:closing_ok', '2-й Zoom после pushback → closing_ok')
  assert(
    /whatsapp|слот|zoom|демо|договорил|жду|11/i.test(later.reply),
    'принимает демо после pushback',
  )
}

{
  // Discovery→discovery: скепсис хотя бы раз (pushback), ритм ask сохраняется
  let s = openingReply('marina').dialogueState
  const u = []
  const d1 = runDialogueTurn({
    userText:
      'Это Тихон, ДентаCRM. Сколько заявок теряется из WhatsApp?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: u,
  })
  u.push(d1.reply)
  s = d1.dialogueState
  assert(
    d1.policyId === 'beat:discovery_pain' ||
      d1.policyId === 'beat:discovery_answer',
    'первый discovery = pain',
  )

  const d2 = runDialogueTurn({
    userText: 'А из‑за ручного ввода и забытых напоминаний?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: u,
  })
  console.log('marinaPushbackDiscovery', d2.policyId, d2.reply)
  assert(
    d2.policyId === 'beat:persona_pushback',
    'второй discovery у скептика → persona_pushback',
  )
  assert(
    /цифр|успевают|пациент|некогда|презентац|15\s*секунд|откуда|суть/i.test(
      d2.reply,
    ),
    'в discovery есть сомнение/тайм-прессинг',
  )
  assert(
    d2.dialogueState.slots.personaPushbackShown === true,
    'slot pushback',
  )
  assert(!/\?\s*\?/.test(d2.reply), 'pushback без повторного ?')

  // После «в чём суть?» + pitch → цена / Zoom-objection / next step, НЕ боль
  const pitch = runDialogueTurn({
    userText:
      'Модуль напоминаний и очередь WhatsApp — заявки не висят, админ видит статусы. Закрываем именно вашу дыру.',
    clientId: 'marina',
    dialogueState: d2.dialogueState,
    usedClientReplies: [...u, d2.reply],
  })
  console.log('postPitch', pitch.policyId, pitch.reply)
  assert(
    pitch.policyId === 'beat:pitch_react' ||
      pitch.policyId === 'beat:pitch' ||
      pitch.policyId === 'beat:pitch_followup',
    'после pitch → pitch_react / pitch',
  )
  assert(
    /стоит|цен[аы]|кп|zoom|завтра|глянем|вилк|кресл/i.test(pitch.reply),
    'pitch → ASK_PRICE / OBJECTION_ZOOM / ACCEPT_NEXT_STEP',
  )
  assert(
    !/ирина\s+вручную|ок,?\s*слушаю|заявки\s+висят\s+до\s+вечера/i.test(
      pitch.reply,
    ),
    'после pitch ≠ PAIN_DISCLOSURE / Ок слушаю',
  )

  // После essence + слот → ACCEPT / COUNTER / PRICE, не «сначала суть»
  const slotAfter = runDialogueTurn({
    userText:
      'Давайте завтра 10 минут в Zoom в 11:00 — покажу модуль напоминаний на ваших цифрах.',
    clientId: 'marina',
    dialogueState: pitch.dialogueState,
    usedClientReplies: [...u, d2.reply, pitch.reply],
  })
  console.log('slotAfterEssence', slotAfter.policyId, slotAfter.reply)
  assert(
    slotAfter.policyId === 'beat:closing_ok' ||
      slotAfter.policyId === 'beat:pitch_react' ||
      slotAfter.policyId === 'beat:closing_confirm',
    'slot после essence → accept/react, не objection loop',
  )
  assert(
    !/сначала\s+суть|в\s+ч[её]м\s+суть|тезис\s+одним/i.test(slotAfter.reply),
    'после essence ≠ снова «сначала суть»',
  )
  assert(
    /слот|zoom|whatsapp|стоимость|стоит|вилк|завтра|принима|договорил|час|кп/i.test(
      slotAfter.reply,
    ),
    'slot → ACCEPT_SLOT / COUNTER_SLOT / ASK_PRICE',
  )
  const usedObj = slotAfter.dialogueState.usedObjections ?? []
  assert(
    usedObj.length >= 1 ||
      pitch.dialogueState.slots.personaPushbackShown === true,
    'usedObjections или pushback отмечены',
  )
}

{
  // No-repeat: боль про Ирину не пересказывается вторым discovery-ходом
  let s = openingReply('marina').dialogueState
  const u = []
  const a = runDialogueTurn({
    userText:
      'Это Тихон, ДентаCRM. Кто ведёт запись — журнал / Excel / WhatsApp?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: u,
  })
  u.push(a.reply)
  s = a.dialogueState
  console.log('pain1', a.reply)
  const keys1 = s.usedPainFacts ?? []
  assert(keys1.length >= 1 || /whatsapp|журнал|excel|ирина|админ/i.test(a.reply), 'pain1 зафиксирован')

  const b = runDialogueTurn({
    userText: 'Сколько заявок теряется из WhatsApp за неделю?',
    clientId: 'marina',
    dialogueState: s,
    usedClientReplies: u,
  })
  console.log('pain2', b.policyId, b.reply)
  // Если снова discovery_answer — не та же Ирина-вручную формулировка
  if (/discovery/i.test(b.policyId)) {
    const irinaAgain =
      /ирина.*(вручн|забыв|пишет)/i.test(b.reply) &&
      /ирина.*(вручн|забыв|пишет)/i.test(a.reply)
    assert(!irinaAgain, 'Ирина вручную не повторяется дословно по смыслу')
  }
  assert(
    (b.dialogueState.usedPainFacts ?? []).length >=
      (s.usedPainFacts ?? []).length,
    'usedPainFacts растёт или держится',
  )
}

{
  // Артём: диагностический вопрос → ответ фактом, без «что даёте…»
  const open = openingReply('artem')
  const r = runDialogueTurn({
    userText:
      'Артём, добрый день! Это Тихон, компания X. Кто сейчас ведёт запись пациентов и как фиксируете заявки из мессенджеров?',
    clientId: 'artem',
    dialogueState: open.dialogueState,
    usedClientReplies: [open.reply],
  })
  console.log('artemWorkflowQ', r.policyId, r.reply)
  assert(
    r.policyId === 'beat:discovery_answer' ||
      r.policyId === 'beat:discovery_pain' ||
      r.policyId === 'beat:intro_substance',
    'workflow Q → answer beat',
  )
  assert(
    /запис|администратор|фиксир|журнал|1[сc]|excel|мессенджер|whatsapp|филиал/i.test(
      r.reply,
    ),
    'сначала отвечает про процесс',
  )
  assert(
    !/что\s+да[её]те|для\s+контроля\s+недозвон|какой\s+функционал/i.test(
      r.reply,
    ),
    'без встречного feature-ask',
  )
  // Opening уже был — не дублируем «Добрый день»
  assert(
    !/^добрый\s+день/i.test(r.reply.trim()),
    'нет дубля greeting после opening',
  )
}

{
  // После opening + frame в #1 — без второго «Добрый день»
  const open = openingReply('marina')
  assert(open.dialogueState.slots.greeted === true, 'opening → greeted')
  const r = runDialogueTurn({
    userText:
      'Добрый день! Меня зовут Тихон, ДентаCRM. Удобно 2 минуты по записи пациентов?',
    clientId: 'marina',
    dialogueState: open.dialogueState,
    usedClientReplies: [open.reply],
  })
  console.log('noDupGreet', r.policyId, r.reply)
  assert(!/^добрый\s+день/i.test(r.reply.trim()), 'frame #1 без дубля Добрый день')
  assert(
    r.policyId === 'beat:intro_frame' ||
      r.policyId === 'beat:intro_substance' ||
      (r.policyId !== 'beat:intro_hello' || !/добрый\s+день/i.test(r.reply)),
    'не intro_hello с повторным greeting',
  )
  if (r.policyId === 'beat:intro_frame') {
    assert(
      /минут|пару\s+минут|удобно\s+коротко|слушаю/i.test(r.reply),
      'marina подтверждает минуты',
    )
  }
}

{
  // Артём turn-1: сравнение решений + «удобно 2 минуты» — без галлюцинаций и самозакрытия
  const open = openingReply('artem')
  const r = runDialogueTurn({
    userText:
      'Артём, добрый день! Это Тихон, ДентаCRM. Удобно 2 минуты? Сравниваю решения для сетей клиник.',
    clientId: 'artem',
    dialogueState: open.dialogueState,
    usedClientReplies: [open.reply],
  })
  console.log('artemCompareFrame', r.policyId, r.reply)
  assert(r.policyId === 'beat:intro_frame', 'compare+time → intro_frame')
  assert(
    /минут\s+есть|пару\s+минут|две\s+минут|минуты\s+есть/i.test(r.reply),
    'сначала подтверждает рамку времени',
  )
  assert(/сравнива|критер/i.test(r.reply), 'уточняет, что сравнивают')
  assert(
    !/партн[её]р|проседают|проверю на (наших|своих) цифр/i.test(r.reply),
    'не выдумывает партнёра/метрики и не самозакрывается',
  )
}

{
  // Discovery + вопрос про МИС → Артём явно называет 1С и спрашивает «поверх vs перенос»
  const open = openingReply('artem')
  const intro = runDialogueTurn({
    userText:
      'Артём, добрый день! Это Тихон, ДентаCRM. Удобно 2 минуты по записи?',
    clientId: 'artem',
    dialogueState: open.dialogueState,
    usedClientReplies: [open.reply],
  })
  const r = runDialogueTurn({
    userText:
      'Какая у вас МИС по филиалам — 1С, Инфодент? Чем сейчас ведёте учёт?',
    clientId: 'artem',
    dialogueState: intro.dialogueState,
    usedClientReplies: [open.reply, intro.reply],
  })
  console.log('artemLegacyDiscovery', r.policyId, r.reply)
  assert(
    r.policyId === 'beat:legacy:crm_discovery',
    'discovery+МИС → legacy crm_discovery',
  )
  assert(/1\s*[cс]|1с/i.test(r.reply), 'Артём явно называет 1С')
  assert(
    /поверх|перенос|перегрузк|миграц|стык/i.test(r.reply),
    'уточняет поверх 1С vs перенос данных',
  )
  assert(
    r.dialogueState.slots.legacyCrmRaised === true,
    'слот legacyCrmRaised',
  )
}

console.log('\ndone, exitCode=', process.exitCode ?? 0)
