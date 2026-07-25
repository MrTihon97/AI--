/**
 * Smoke: rule-based reportValidator (no LLM).
 */
import {
  containsLossCalcKeywords,
  containsNextStepKeywords,
  containsProfanity,
  normalizeQuoteKey,
  realignQuoteCards,
  validateAndClassifyQuote,
} from '../src/utils/reportValidator.ts'
import { analyzeRoleplayFeedback } from '../src/services/feedbackEngine.ts'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('OK:', msg)
  }
}

{
  const p = validateAndClassifyQuote('Ты мудак, отстань')
  assert(p.type === 'ERROR' && p.stage === 'Этика', 'profanity → Этика ERROR')
  assert(/этик/i.test(p.whyBad ?? p.comment ?? ''), 'profanity whyBad')
  assert(!p.howToFix, 'profanity без sales howToFix')
  assert(containsProfanity('пошёл нахуй'), 'containsProfanity')
  assert(containsProfanity('ты дура'), 'containsProfanity дура')
  assert(containsProfanity('иди в жопу'), 'containsProfanity в жопу')
}

{
  // Evaluator: мат не уходит в discovery/closing + ETIQUETTE_VIOLATION
  const tox = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, удобно минуту?',
      'Ты дура, иди в жопу',
      'Давайте завтра Zoom в 11:00',
    ],
    dialogueState: {
      sessionStatus: 'terminated_etiquette',
      failReason: 'terminated_etiquette',
      warningCount: 2,
    },
  })
  assert(tox.feedback.etiquetteViolation === true, 'etiquetteViolation flag')
  assert(tox.feedback.totalScore === 1.0, 'toxicity totalScore = 1.0')
  assert(
    tox.feedback.failReason === 'terminated_etiquette',
    'failReason TERMINATED_ETIQUETTE',
  )
  assert(
    /ТРЕБУЕТСЯ ПЕРЕСДАЧА/i.test(tox.feedback.verdictLabel ?? ''),
    'verdict ТРЕБУЕТСЯ ПЕРЕСДАЧА',
  )
  assert(
    tox.insights.some((i) => i.id === 'ETIQUETTE_VIOLATION'),
    'insight ETIQUETTE_VIOLATION',
  )
  assert(
    tox.feedback.mistakes.every(
      (m) =>
        m.tag === 'etiquette_violation' &&
        /2\+\s*нарушен|ненорматив/i.test(m.comment) &&
        /профессиональный тон/i.test(m.betterScript ?? ''),
    ),
    'этика-карточка: reason + correct action',
  )
  assert(
    !tox.feedback.mistakes.some((m) =>
      ['discovery', 'presentation', 'closing'].includes(m.stageId),
    ),
    'мат ≠ discovery/presentation/closing',
  )
  const classified = validateAndClassifyQuote('Ты дура, иди в жопу')
  assert(classified.stageId === 'contact', 'abuse classify → contact/этика')
  assert(classified.ruleId === 'RULE_ETHICS', 'abuse ruleId ETHICS')
}

{
  // Evaluator: 3+ offtopic → TERMINATED_OFFTOPIC
  const off = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день',
      'как дела вообще',
      'футбол вчера смотрели кстати',
      'анекдот расскажите',
    ],
    intentLog: [
      { intentId: 'greeting', managerQuote: 'Добрый день' },
      { intentId: 'offtopic_confused', managerQuote: 'анекдот расскажите' },
    ],
    dialogueState: {
      sessionStatus: 'terminated_offtopic',
      failReason: 'terminated_offtopic',
      slots: { offTopicCount: 3 },
    },
  })
  assert(off.feedback.offTopicViolation === true, 'offTopicViolation flag')
  assert(off.feedback.totalScore === 1.0, 'offtopic totalScore = 1.0')
  assert(
    off.feedback.failReason === 'terminated_offtopic',
    'failReason TERMINATED_OFFTOPIC',
  )
  assert(
    /ТРЕБУЕТСЯ ПЕРЕСДАЧА/i.test(off.feedback.verdictLabel ?? ''),
    'offtopic verdict ТРЕБУЕТСЯ ПЕРЕСДАЧА',
  )
  assert(
    off.insights.some((i) => i.id === 'OFFTOPIC_VIOLATION'),
    'insight OFFTOPIC_VIOLATION',
  )
  assert(
    off.feedback.mistakes.every((m) => m.tag === 'offtopic_violation'),
    'offtopic-карточка tag',
  )
}

{
  const p = validateAndClassifyQuote(
    'Давайте завтра в 15:00 Zoom на 10 минут — пришлю ссылку в WhatsApp',
  )
  assert(p.type === 'SUCCESS' && p.stageId === 'closing', 'next step → closing SUCCESS')
  assert(containsNextStepKeywords(p.quote), 'next step keywords')
}

{
  const p = validateAndClassifyQuote(
    'Добрый день! Меня зовут Тихон, компания X. Звоню по поводу CRM.',
  )
  assert(p.type === 'SUCCESS' && p.stageId === 'contact', 'greeting → contact')
  assert(p.stage === 'Установление контакта', 'greeting label')
}

{
  const p = validateAndClassifyQuote(
    'Потери по филиалам 10–20%, окупаемость за счёт неявок.',
  )
  assert(
    ['discovery', 'presentation', 'objections'].includes(p.stageId),
    'finance → discovery|presentation|objections',
  )
  assert(p.stageId !== 'closing', 'finance ≠ closing')
}

{
  // Потери в ₽ — discovery/presentation, НЕ закрытие
  const loss =
    'Клиники упускают от 3 до 5 заявок в неделю — это 30 000 – 50 000 ₽ выручки.'
  const p = validateAndClassifyQuote(loss)
  assert(containsLossCalcKeywords(loss), 'loss calc keywords')
  assert(!containsNextStepKeywords(loss), 'loss calc ≠ next step')
  assert(
    p.stageId === 'discovery' || p.stageId === 'presentation',
    'loss ₽ → discovery|presentation',
  )
  assert(p.stageId !== 'closing', 'loss ₽ ≠ closing')
}

{
  const p = validateAndClassifyQuote(
    'Удобно в 11:00 или в 15:00 — включаемся в Zoom',
  )
  assert(p.stageId === 'closing' && p.type === 'SUCCESS', 'явный слот → closing')
}

{
  // Closing priority: Zoom/слот побеждает «потери» / «рублей»
  const mixed =
    'Потери клиники до 50 тысяч рублей — давайте завтра в 11:00 Zoom на 10 минут'
  const p = validateAndClassifyQuote(mixed)
  assert(p.stageId === 'closing', 'потери+Zoom → CLOSING (не discovery)')
  assert(p.ruleId === 'RULE_CLOSING_SLOT', 'ruleId closing slot')
  assert(
    /Zoom|11:00|слот/i.test(p.howToFix ?? ''),
    'howToFix closing, не discovery-вопрос',
  )
  assert(
    !/Уточните процесс: кто отвечает за дожим/i.test(p.howToFix ?? ''),
    'не дефолт discovery на closing',
  )
}

{
  // Presentation priority: продуктовые фичи
  const pitch =
    'Подключаем автобот и блок автоответов — он фиксирует запись без администратора'
  const p = validateAndClassifyQuote(pitch)
  assert(p.stageId === 'presentation', 'автобот → PRESENTATION')
  assert(p.ruleId === 'RULE_PRESENTATION_FEATURES', 'ruleId presentation')
  assert(/автобот|фич/i.test(p.howToFix ?? ''), 'howToFix presentation')
  assert(
    !/Уточните процесс: кто отвечает за дожим/i.test(p.howToFix ?? ''),
    'не дефолт discovery на presentation',
  )
}

{
  // Discovery только с вопросом
  const noQ = validateAndClassifyQuote(
    'Клиники упускают от 3 до 5 заявок — это 30 000 – 50 000 ₽ выручки.',
  )
  assert(
    noQ.stageId === 'discovery' || noQ.stageId === 'presentation',
    'loss без ? → discovery|presentation stage',
  )
  assert(
    noQ.type === 'ERROR' ||
      noQ.ruleId === 'RULE_DISCOVERY_WEAK' ||
      noQ.ruleId === 'RULE_NO_QUESTION_FOUND',
    'loss без ? не SUCCESS discovery-question',
  )

  const withQ = validateAndClassifyQuote(
    'Сколько заявок теряется из WhatsApp за неделю?',
  )
  assert(
    withQ.stageId === 'discovery' && withQ.type === 'SUCCESS',
    'вопрос ? → DISCOVERY SUCCESS',
  )

  // Вопросительные слова без «?» + хвостовая пунктуация ≠ «нет вопроса»
  const trailing =
    'кто ведёт запись — журнал / Excel / WhatsApp , '
  const trail = validateAndClassifyQuote(trailing)
  assert(trail.stageId === 'discovery', 'кто…WhatsApp , → DISCOVERY')
  assert(trail.type === 'SUCCESS', 'кто без ? → SUCCESS (не ERROR)')
  assert(
    trail.ruleId === 'RULE_DISCOVERY_QUESTION',
    'кто без ? → RULE_DISCOVERY_QUESTION',
  )
  assert(
    trail.ruleId !== 'RULE_NO_QUESTION_FOUND' &&
      trail.ruleId !== 'RULE_DISCOVERY_WEAK',
    'не NO_QUESTION_FOUND / DISCOVERY_WEAK',
  )

  const noMark = validateAndClassifyQuote(
    'Есть ли у вас журнал записи или Excel',
  )
  assert(
    noMark.stageId === 'discovery' && noMark.type === 'SUCCESS',
    'есть ли без ? → DISCOVERY SUCCESS',
  )
}

{
  // realign trusts FSM stage stamp — no post-hoc keyword remap
  const aligned = realignQuoteCards({
    mistakes: [
      {
        stageId: 'closing',
        managerQuote:
          'Потери 40 тысяч — давайте завтра Zoom в 15:00, пришлю ссылку',
        comment: 'Слот на закрытии',
        betterScript: 'Завтра 15:00 Zoom, 15 минут. Пришлю ссылку в WhatsApp.',
      },
      {
        stageId: 'presentation',
        managerQuote: 'Подключаем блок автоответов, фиксирует запись',
        comment: 'Фичи без боли',
        betterScript:
          'Свяжите автоответы с болью: заявки не висят вечером.',
      },
      {
        stageId: 'discovery',
        managerQuote: 'Сколько заявок теряется из WhatsApp?',
        comment: 'Слабое выявление',
      },
    ],
    successes: [],
  })
  assert(
    aligned.mistakes.find((m) => /zoom|15:00/i.test(m.managerQuote))
      ?.stageId === 'closing',
    'realign: trusts closing stamp for Zoom',
  )
  assert(
    aligned.mistakes.find((m) => /автоответ/i.test(m.managerQuote))
      ?.stageId === 'presentation',
    'realign: trusts presentation stamp',
  )
  assert(
    aligned.mistakes.find((m) => /whatsapp/i.test(m.managerQuote))
      ?.stageId === 'discovery',
    'realign: trusts discovery stamp (no cross-stage)',
  )
}

{
  // realign keeps stage stamps; engine stamps contact at send time
  const aligned = realignQuoteCards({
    mistakes: [
      {
        stageId: 'closing',
        managerQuote: 'Завтра в 11:00 демо в Zoom — удобно?',
        comment: 'Слот без подтверждения',
        betterScript: '…',
      },
      {
        stageId: 'objections',
        managerQuote: 'Добрый день, меня зовут Алексей, компания ДентаCRM',
        comment: 'Не отработано возражение',
      },
    ],
    successes: [],
  })
  assert(
    aligned.mistakes.some(
      (m) => m.stageId === 'closing' && containsNextStepKeywords(m.managerQuote),
    ),
    'realign: closing stamp kept for next-step',
  )
  assert(
    aligned.mistakes.some(
      (m) => m.stageId === 'objections' && /добрый день/i.test(m.managerQuote),
    ),
    'realign: does not remapping greeting across stages',
  )
}

{
  // ERROR подавляет SUCCESS на той же цитате
  const q =
    'Клиники упускают от 3 до 5 заявок — это 30–50 тыс. ₽ в месяц.'
  const aligned = realignQuoteCards({
    mistakes: [
      {
        stageId: 'discovery',
        managerQuote: q,
        comment: 'Цифра есть, но вопрос слабый',
      },
    ],
    successes: [
      {
        stageId: 'closing',
        managerQuote: q,
        comment: 'Ложный успех закрытия',
      },
      {
        stageId: 'discovery',
        managerQuote: q,
        comment: 'Дубль успеха на той же цитате',
      },
    ],
  })
  assert(
    aligned.mistakes.some(
      (m) => normalizeQuoteKey(m.managerQuote) === normalizeQuoteKey(q),
    ),
    'dedupe: ERROR сохранён',
  )
  assert(
    !aligned.successes.some(
      (s) => normalizeQuoteKey(s.managerQuote) === normalizeQuoteKey(q),
    ),
    'dedupe: SUCCESS на той же цитате подавлен',
  )
  assert(
    aligned.mistakes.every((m) => m.stageId !== 'closing'),
    'dedupe: loss quote не closing',
  )
}

{
  // realign: ошибка возражений с WhatsApp/слотом в цитате не должна стать SUCCESS
  const aligned = realignQuoteCards({
    mistakes: [
      {
        stageId: 'objections',
        managerQuote:
          'Подписка 3000–5000, завтра в Zoom сверю окупаемость и пришлю в WhatsApp',
        comment: 'Вилка цены без экономики клиента',
        betterScript: '…',
      },
    ],
    successes: [],
  })
  assert(
    aligned.mistakes.some((m) => m.stageId === 'objections'),
    'realign: objections ERROR сохраняется',
  )
}

{
  // Hard-gate Zoom pushback → возражения НЕ «НЕДОСТАТОЧНО ДАННЫХ»
  const hardGate = analyzeRoleplayFeedback({
    managerMessages: [
      'Это Тихон, ДентаCRM. Удобно 2 минуты?',
      'Клиники упускают от 3 до 5 заявок — это 30–50 тыс. ₽.',
      'Давайте Zoom завтра в 11:00',
      'Цифра из чека × неявки — окупаемость за недели. Давайте 11:00',
    ],
    dialogueState: {
      slots: {
        personaPushbackShown: true,
        hasHandledObjection: true,
        closingAttempts: 2,
        painFound: true,
        developedArgument: true,
      },
    },
  })
  const objRow = hardGate.feedback.stageScores.find((s) => s.stageId === 'objections')
  assert(objRow != null, 'hard-gate: objections stage есть')
  assert(
    !/НЕДОСТАТОЧНО ДАННЫХ/i.test(objRow?.comment ?? ''),
    'hard-gate: objections ≠ N/A',
  )
  assert(
    hardGate.insights.some((i) => /OBJECTION_RAISED/i.test(i.label)),
    'hard-gate: insight OBJECTION_RAISED',
  )

  const cards = [
    ...hardGate.feedback.mistakes,
    ...(hardGate.feedback.successes ?? []),
  ]
  const greetingCards = cards.filter((c) =>
    /это\s+тихон|дента\s*crm.*удобно|удобно\s+2\s+минут/i.test(c.managerQuote),
  )
  assert(greetingCards.length >= 1, 'greeting quote есть в разборе')
  assert(
    greetingCards.every((c) => c.stageId === 'contact'),
    'greeting → только Установление контакта',
  )
  assert(
    !cards.some((c) => c.stageId === 'presentation' && /удобно\s+2\s+минут/i.test(c.managerQuote)),
    'greeting ≠ presentation',
  )
  assert(
    !cards.some((c) => !c.managerQuote?.trim() || c.managerQuote.trim() === '—'),
    'нет пустых цитат «—» при живом диалоге',
  )

  const greetOnly = validateAndClassifyQuote(
    'Это Тихон, ДентаCRM. Удобно 2 минуты?',
  )
  assert(
    greetOnly.stageId === 'contact' && greetOnly.type === 'SUCCESS',
    'classify: Это Тихон, ДентаCRM → contact',
  )
}

{
  // Нет возражения → не штрафуем objections
  const noObj = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, удобно 8 минут?',
      'Сколько заявок теряется из WhatsApp за неделю?',
      'Давайте завтра Zoom на 10 минут — пришлю ссылку в WhatsApp',
    ],
    intentLog: [
      { intentId: 'greeting', managerQuote: 'Добрый день, удобно 8 минут?' },
      {
        intentId: 'need_discovery',
        managerQuote: 'Сколько заявок теряется из WhatsApp за неделю?',
      },
      {
        intentId: 'closing',
        managerQuote:
          'Давайте завтра Zoom на 10 минут — пришлю ссылку в WhatsApp',
      },
    ],
  })
  const objRow = noObj.feedback.stageScores.find((s) => s.stageId === 'objections')
  assert(objRow && objRow.score >= 8, 'нет возражения → objections ≥ 8')
  assert(
    /НЕДОСТАТОЧНО ДАННЫХ/i.test(objRow?.comment ?? ''),
    'нет возражения → комментарий N/A',
  )

  // Loss quote в отчёте не уходит в closing
  const withLoss = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, удобно минуту?',
      'Клиники упускают от 3 до 5 заявок — это 30 000 – 50 000 ₽.',
      'Давайте завтра в 11:00 Zoom — пришлю ссылку',
    ],
    intentLog: [
      { intentId: 'greeting', managerQuote: 'Добрый день, удобно минуту?' },
      {
        intentId: 'need_discovery',
        managerQuote:
          'Клиники упускают от 3 до 5 заявок — это 30 000 – 50 000 ₽.',
      },
      {
        intentId: 'closing',
        managerQuote: 'Давайте завтра в 11:00 Zoom — пришлю ссылку',
      },
    ],
  })
  const cards = [
    ...withLoss.feedback.mistakes,
    ...(withLoss.feedback.successes ?? []),
  ]
  const lossCards = cards.filter((c) => /упускают|30 000/i.test(c.managerQuote))
  assert(lossCards.length >= 1, 'loss quote есть в разборе')
  assert(
    lossCards.every((c) => c.stageId === 'discovery' || c.stageId === 'presentation'),
    'loss quote → discovery|presentation',
  )
  assert(
    lossCards.filter((c) => /упускают/i.test(c.managerQuote)).length === 1,
    'loss quote ровно одна карточка',
  )
  // Нет дубля ERROR+SUCCESS на одной цитате
  const keys = new Map()
  for (const m of withLoss.feedback.mistakes) {
    const k = normalizeQuoteKey(m.managerQuote)
    if (k === '—') continue
    keys.set(k, 'err')
  }
  for (const s of withLoss.feedback.successes ?? []) {
    const k = normalizeQuoteKey(s.managerQuote)
    if (k === '—') continue
    assert(keys.get(k) !== 'err', `нет дубля ERROR+SUCCESS: ${k.slice(0, 40)}`)
  }
  // Живые цитаты уникальны среди ERROR
  const errLive = withLoss.feedback.mistakes
    .map((m) => normalizeQuoteKey(m.managerQuote))
    .filter((k) => k && k !== '—')
  assert(
    new Set(errLive).size === errLive.length,
    'ERROR: нет дублей живых цитат',
  )
}

{
  // Strict turn→stage: Zoom closing (Turn 5) ≠ CONTACT; contact только Turn 1
  const lateClose = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, это Тихон, ДентаCRM. Удобно 2 минуты?',
      'кто ведёт запись — журнал / Excel / WhatsApp?',
      'Сколько заявок теряется из WhatsApp за неделю?',
      'Одна неявка ≈ 3000 ₽, 10 возвратов бьют подписку',
      'Завтра на 10 минут заглянем в Zoom — удобно в 11:00 или в 15:00?',
    ],
  })
  const allLate = [
    ...(lateClose.feedback.successes ?? []),
    ...lateClose.feedback.mistakes,
  ]
  const zoomCards = allLate.filter((c) =>
    /zoom|11:00|15:00|заглянем/i.test(c.managerQuote),
  )
  assert(zoomCards.length >= 1, 'Zoom-цитата есть в разборе')
  assert(
    zoomCards.every((c) => c.stageId === 'closing'),
    'Zoom/слот → только «Завершение сделки»',
  )
  assert(
    !allLate.some(
      (c) =>
        c.stageId === 'contact' &&
        /zoom|11:00|15:00|заглянем|завтра\s+на\s+10/i.test(c.managerQuote),
    ),
    'Zoom ≠ ERROR/SUCCESS «Установление контакта»',
  )
  const contactCards = allLate.filter((c) => c.stageId === 'contact')
  for (const c of contactCards) {
    assert(
      /добрый\s+день|тихон|дента|удобно\s+2\s+минут/i.test(c.managerQuote),
      'contact-карточка только про Turn 1',
    )
  }
  // Нет смеси Turn1 + Turn5 в одном stage bucket contact
  assert(
    contactCards.every((c) => !/zoom|заглянем/i.test(c.managerQuote)),
    'contact bucket без поздних реплик',
  )

  // Слабый контакт + Zoom: поздняя реплика не уходит в contact ERROR
  const weakPlusZoom = analyzeRoleplayFeedback({
    managerMessages: [
      'Привет',
      'кто ведёт?',
      'Сколько заявок?',
      'Ок',
      'Завтра на 10 минут заглянем в Zoom — удобно в 11:00 или в 15:00?',
    ],
  })
  const wzAll = [
    ...(weakPlusZoom.feedback.successes ?? []),
    ...weakPlusZoom.feedback.mistakes,
  ]
  assert(
    !wzAll.some(
      (c) =>
        c.stageId === 'contact' &&
        (/zoom|11:00|заглянем/i.test(c.managerQuote) ||
          /^ок\.?$/i.test(c.managerQuote.trim())),
    ),
    'слабый контакт: Zoom/«Ок» ≠ contact',
  )
  assert(
    wzAll
      .filter((c) => /zoom|11:00|заглянем/i.test(c.managerQuote))
      .every((c) => c.stageId === 'closing'),
    'Zoom при слабом контакте → closing',
  )
}

{
  // Полная рамка Turn 1 → contact = 10, без MISSING_FRAME
  const full = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, это Тихон, ДентаCRM. Удобно 2 минуты? Цель — понять потери на записи.',
      'Модуль напоминаний закрывает неявки — покажу на ваших цифрах.',
      'Давайте завтра Zoom в 11:00',
    ],
  })
  const contactRow = full.feedback.stageScores.find((s) => s.stageId === 'contact')
  assert(contactRow && contactRow.score >= 9.5, 'полная рамка → contact ≈ 10')
  assert(
    !full.insights.some((i) => i.id === 'MISSING_FRAME_ERROR'),
    'полная рамка → нет MISSING_FRAME',
  )
  assert(
    !/MISSING_FRAME/i.test(contactRow?.comment ?? ''),
    'comment без MISSING_FRAME',
  )
  assert(
    /озвучены корректно|эталонн/i.test(contactRow?.comment ?? ''),
    'passed contact comment human-readable',
  )
  const contactOk = (full.feedback.successes ?? []).find(
    (s) => s.stageId === 'contact',
  )
  assert(contactOk, 'SUCCESS contact при полной рамке')

  // why_worked презентации: stage stamp + sanitize justification
  const aligned = realignQuoteCards({
    mistakes: [],
    successes: [
      {
        stageId: 'presentation',
        managerQuote:
          'Модуль напоминаний и очередь WhatsApp закрывают потери заявок',
        comment:
          'Есть вход в контакт: приветствие / представление. Этап — только «Установление контакта».',
      },
      {
        stageId: 'presentation',
        managerQuote:
          'Как раз для этого и подключаем автобота — он фиксирует запись и снимает нагрузку с администратора.',
        comment:
          'Диагностический вопрос клиенту — этап «Выявление потребностей».',
      },
    ],
  })
  const pres = aligned.successes.filter((s) => s.stageId === 'presentation')
  assert(pres.length >= 1, 'автобот/модуль → presentation карточка')
  for (const card of pres) {
    assert(
      !/диагностическ|выявление\s+потребност|вход\s+в\s+контакт/i.test(
        card.comment ?? '',
      ),
      'presentation why_worked ≠ discovery/contact',
    )
    assert(
      /презентац|выгод|фича|боль|привязан/i.test(card.comment ?? ''),
      'presentation why_worked про питч',
    )
  }

  const botClass = validateAndClassifyQuote(
    'Как раз для этого и подключаем автобота — он фиксирует запись.',
  )
  assert(botClass.stageId === 'presentation', 'classify: автобот → presentation')
  assert(
    !/диагностическ|выявление\s+потребност/i.test(botClass.comment ?? ''),
    'classify comment ≠ discovery',
  )

  const fullFb = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, это Тихон, ДентаCRM. Удобно 2 минуты?',
      'Сколько заявок теряется из WhatsApp за неделю?',
      'Как раз для этого и подключаем автобота — фиксирует запись.',
    ],
    intentLog: [
      {
        intentId: 'greeting',
        managerQuote: 'Добрый день, это Тихон, ДентаCRM. Удобно 2 минуты?',
        stage: 'contact',
        fsmStage: 'intro',
      },
      {
        intentId: 'need_discovery',
        managerQuote: 'Сколько заявок теряется из WhatsApp за неделю?',
        stage: 'discovery',
        fsmStage: 'discovery',
      },
      {
        intentId: 'value_pitch',
        managerQuote: 'Как раз для этого и подключаем автобота — фиксирует запись.',
        stage: 'presentation',
        fsmStage: 'presentation',
      },
    ],
  })
  const allCards = [
    ...(fullFb.feedback.successes ?? []),
    ...fullFb.feedback.mistakes,
  ]
  const presCard = allCards.find((s) => /автобот/i.test(s.managerQuote ?? ''))
  assert(!!presCard, 'report: есть карточка с автоботом')
  assert(presCard.stageId === 'presentation', 'report: автобот stage presentation')
  assert(
    !/диагностическ|выявление\s+потребност/i.test(presCard.comment ?? ''),
    'report: presentation justification ≠ discovery',
  )
  assert(
    /презентац|выгод|фича|боль|связк|решени/i.test(presCard.comment ?? ''),
    'report: presentation why_worked про питч',
  )
}

{
  // Skip contact → diagnostic must be DISCOVERY, not failed CONTACT
  const skipContact = analyzeRoleplayFeedback({
    managerMessages: [
      'кто ведёт запись — журнал / Excel / WhatsApp , ',
      'Сколько заявок теряется из WhatsApp за неделю?',
    ],
  })
  const discErr = skipContact.feedback.mistakes.find(
    (m) =>
      m.stageId === 'contact' &&
      /кто\s+вед|журнал|excel|whatsapp|сколько\s+заявк/i.test(m.managerQuote),
  )
  assert(
    skipContact.feedback.successes?.some((s) => s.stageId === 'discovery') ||
      skipContact.feedback.mistakes.some(
        (m) =>
          m.stageId === 'discovery' &&
          /кто\s+вед|сколько\s+заявк/i.test(m.managerQuote),
      ),
    'диагностика без контакта → DISCOVERY',
  )
  assert(!discErr, 'диагностика ≠ ERROR «Установление контакта»')
  assert(
    skipContact.insights.some((i) => i.id === 'MISSING_FRAME_ERROR'),
    'session MISSING_FRAME_ERROR',
  )
  const skipContactRow = skipContact.feedback.stageScores.find(
    (s) => s.stageId === 'contact',
  )
  assert(
    !/MISSING_FRAME\s*:/i.test(skipContactRow?.comment ?? ''),
    'failed contact comment без сырого MISSING_FRAME:',
  )
  assert(
    /не хватило четкого представления|цели звонка/i.test(
      skipContactRow?.comment ?? '',
    ),
    'failed contact comment human-readable',
  )
  const contactMistake = skipContact.feedback.mistakes.find(
    (m) => m.stageId === 'contact',
  )
  if (contactMistake?.betterScript) {
    assert(
      /добрый\s+день|удобно|дента|первом\s+ходе|рамка/i.test(
        contactMistake.betterScript,
      ),
      'contact howToFix про рамку первого хода',
    )
  }

  const classified = validateAndClassifyQuote(
    'кто ведёт запись — журнал / Excel / WhatsApp , ',
  )
  assert(classified.stageId === 'discovery', 'classify: кто ведёт → discovery')
  assert(classified.type === 'SUCCESS', 'classify: кто ведёт → SUCCESS')
}

{
  // Offtopic first, then intro on turn 2 → контакт засчитывается
  const delayed = analyzeRoleplayFeedback({
    managerMessages: [
      'тест скрипт бла бла',
      'Здравствуйте, я Тихон из ДентаCRM. Удобно 2 минуты?',
      'Сколько заявок теряется из WhatsApp за неделю?',
    ],
  })
  const delayedContact = delayed.feedback.stageScores.find(
    (s) => s.stageId === 'contact',
  )
  assert(
    !delayed.insights.some((i) => i.id === 'MISSING_FRAME_ERROR'),
    'delayed intro → нет MISSING_FRAME_ERROR',
  )
  assert(
    delayedContact && delayedContact.score >= 8,
    'delayed intro → contact ≥ 8 (не 4.4)',
  )
  assert(
    !/MISSING_FRAME/i.test(delayedContact?.comment ?? ''),
    'delayed intro comment без MISSING_FRAME',
  )
  assert(
    /озвучены корректно/i.test(delayedContact?.comment ?? ''),
    'delayed intro → human passed comment',
  )
  assert(
    (delayed.feedback.successes ?? []).some((s) => s.stageId === 'contact'),
    'delayed intro → SUCCESS contact',
  )
}

{
  // Fuzzy next step без дня+времени → closing ≤ 6.0
  const fuzzy = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, это Тихон, ДентаCRM. Удобно 2 минуты?',
      'Сколько заявок теряется из WhatsApp?',
      'Договорились. Напишите в WhatsApp, когда удобно',
    ],
  })
  const closing = fuzzy.feedback.stageScores.find((s) => s.stageId === 'closing')
  assert(!!closing, 'fuzzy: есть этап closing')
  assert(closing.score <= 6.0, 'fuzzy next step → closing ≤ 6.0')
  assert(
    /Размытый следующий шаг: дата и время встречи не зафиксированы/i.test(
      closing.comment,
    ),
    'fuzzy critique про дату/время',
  )

  const concrete = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, это Тихон, ДентаCRM. Удобно 2 минуты?',
      'Сколько заявок теряется из WhatsApp?',
      'Давайте завтра в 11:00 Zoom на 10 минут — пришлю ссылку',
    ],
  })
  const closingOk = concrete.feedback.stageScores.find(
    (s) => s.stageId === 'closing',
  )
  assert(!!closingOk, 'slot: есть этап closing')
  assert(
    !/Размытый следующий шаг/i.test(closingOk.comment),
    'конкретный слот ≠ fuzzy critique',
  )
}

{
  // Слабый этап → ERROR-карточка (если есть живая цитата; без «—»)
  const weak = analyzeRoleplayFeedback({
    managerMessages: [
      'Привет',
      'У нас CRM крутая',
      'Ну как-то так',
    ],
    intentLog: [
      { intentId: 'greeting', managerQuote: 'Привет' },
      { intentId: 'product_pitch_response', managerQuote: 'У нас CRM крутая' },
    ],
  })
  const weakStages = weak.feedback.stageScores.filter((s) => s.score < 7)
  for (const s of weakStages) {
    if (/НЕДОСТАТОЧНО ДАННЫХ/i.test(s.comment)) continue
    const hasErr = weak.feedback.mistakes.some((m) => m.stageId === s.stageId)
    if (hasErr) {
      assert(true, `этап ${s.stageId} <7 → есть ОШИБКА`)
      continue
    }
    // Контакт может держаться на SUCCESS-интро без ERROR-карточки
    if (
      s.stageId === 'contact' &&
      (weak.feedback.successes ?? []).some(
        (x) =>
          x.stageId === 'contact' &&
          x.managerQuote?.trim() &&
          x.managerQuote.trim() !== '—',
      )
    ) {
      assert(true, `этап contact <7 → SUCCESS intro без «—»`)
      continue
    }
    // Нет свободной живой цитаты → карточку с «—» не создаём
    assert(
      !weak.feedback.mistakes.some(
        (m) => !m.managerQuote?.trim() || m.managerQuote.trim() === '—',
      ),
      `этап ${s.stageId} <7 без ERROR → нет пустых «—»`,
    )
  }
}

{
  // Closing quote: Zoom stamped as objection → fallback to last closing proposal
  const zoom =
    'Давайте завтра в 12:00 Zoom на 10 минут — пришлю ссылку в WhatsApp'
  const fb = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, это Тихон, ДентаCRM. Удобно 2 минуты?',
      'Сколько заявок теряется из WhatsApp?',
      zoom,
    ],
    intentLog: [
      {
        intentId: 'greeting',
        managerQuote: 'Добрый день, это Тихон, ДентаCRM. Удобно 2 минуты?',
        stage: 'contact',
        fsmStage: 'intro',
      },
      {
        intentId: 'need_discovery',
        managerQuote: 'Сколько заявок теряется из WhatsApp?',
        stage: 'discovery',
        fsmStage: 'discovery',
      },
      {
        intentId: 'closing',
        managerQuote: zoom,
        // send-time stamp ещё objection — типичный баг auto-complete
        stage: 'objections',
        fsmStage: 'objection',
      },
    ],
    dialogueState: {
      stage: 'closing',
      sessionStatus: 'completed',
      slots: { demoOffered: true, painFound: true },
    },
  })
  const cards = [
    ...(fb.feedback.successes ?? []),
    ...fb.feedback.mistakes,
  ]
  const closeCard = cards.find((c) => c.stageId === 'closing')
  assert(!!closeCard, 'closing: есть карточка этапа')
  assert(
    /zoom|12:00|завтра/i.test(closeCard.managerQuote ?? ''),
    'closing: цитата = Zoom/время, не placeholder',
  )
  assert(
    !/не зафиксировано реплик менеджера/i.test(closeCard.managerQuote ?? ''),
    'closing: не generic placeholder',
  )
}

// Soft presentation: ценность без stamp presentation → этап засчитан, без placeholder
{
  const valueLine =
    'Единый дашборд и автодожим WhatsApp: +8–12% загрузки кресел и минус 2–3 неявки в неделю снимают нагрузку с администратора.'
  const fb = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, это Тихон из ДентаCRM. Удобно 2 минуты?',
      'Сколько заявок теряется из WhatsApp за неделю?',
      valueLine,
      'Давайте завтра в 12:00 Zoom — покажу на ваших цифрах.',
    ],
    intentLog: [
      {
        intentId: 'greeting',
        managerQuote: 'Добрый день, это Тихон из ДентаCRM. Удобно 2 минуты?',
        stage: 'contact',
        fsmStage: 'intro',
      },
      {
        intentId: 'need_discovery',
        managerQuote: 'Сколько заявок теряется из WhatsApp за неделю?',
        stage: 'discovery',
        fsmStage: 'discovery',
      },
      {
        intentId: 'need_discovery',
        // ценность ушла в stamp discovery (типичный mixed turn)
        managerQuote: valueLine,
        stage: 'discovery',
        fsmStage: 'discovery',
      },
      {
        intentId: 'closing',
        managerQuote: 'Давайте завтра в 12:00 Zoom — покажу на ваших цифрах.',
        stage: 'closing',
        fsmStage: 'closing',
      },
    ],
    dialogueState: {
      stage: 'closing',
      sessionStatus: 'completed',
      slots: { demoOffered: true, painFound: true },
    },
  })
  const presScore = fb.feedback.stageScores.find(
    (s) => s.stageId === 'presentation',
  )
  assert(!!presScore, 'presentation soft: есть stageScore')
  assert(presScore.score >= 7, 'presentation soft: этап засчитан (≥7)')
  const allText = [
    ...(fb.feedback.successes ?? []).map((s) => s.managerQuote),
    ...fb.feedback.mistakes.map((m) => m.managerQuote),
    ...fb.feedback.mistakes.map((m) => m.comment),
  ].join('\n')
  assert(
    !/на этапе презентации не зафиксировано реплик менеджера/i.test(allText),
    'presentation soft: запрещён placeholder «нет реплик»',
  )
  const cards = [
    ...(fb.feedback.successes ?? []),
    ...fb.feedback.mistakes,
  ]
  const valueCard = cards.find((c) =>
    /дашборд|автодожим/i.test(c.managerQuote ?? ''),
  )
  assert(!!valueCard, 'presentation soft: карточка с ценностью')
  assert(
    valueCard.stageId === 'presentation',
    'presentation soft: ценность → stage presentation',
  )
}

// Прыжок клиента к слоту без отдельного presentation-stamp — без штрафа «пустой питч»
{
  const fb = analyzeRoleplayFeedback({
    managerMessages: [
      'Здравствуйте, я Тихон, ДентаCRM. Удобно пару минут?',
      'Кто у вас ведёт журнал записи и сколько неявок в неделю?',
      'Ок, давайте сразу завтра 14:00 Zoom — зафиксируем.',
    ],
    intentLog: [
      {
        intentId: 'greeting',
        managerQuote:
          'Здравствуйте, я Тихон, ДентаCRM. Удобно пару минут?',
        stage: 'contact',
        fsmStage: 'intro',
      },
      {
        intentId: 'need_discovery',
        managerQuote:
          'Кто у вас ведёт журнал записи и сколько неявок в неделю?',
        stage: 'discovery',
        fsmStage: 'discovery',
      },
      {
        intentId: 'closing',
        managerQuote: 'Ок, давайте сразу завтра 14:00 Zoom — зафиксируем.',
        stage: 'closing',
        fsmStage: 'closing',
      },
    ],
    dialogueState: {
      stage: 'closing',
      sessionStatus: 'completed',
      slots: { demoOffered: true, painFound: true },
    },
  })
  const presScore = fb.feedback.stageScores.find(
    (s) => s.stageId === 'presentation',
  )
  assert(!!presScore, 'jump-to-slot: есть presentation score')
  assert(
    presScore.score >= 5,
    'jump-to-slot: без штрафа за сжатую презентацию',
  )
  const mistText = fb.feedback.mistakes
    .filter((m) => m.stageId === 'presentation')
    .map((m) => `${m.managerQuote}\n${m.comment}`)
    .join('\n')
  assert(
    !/на этапе презентации не зафиксировано реплик менеджера/i.test(mistText),
    'jump-to-slot: нет placeholder presentation',
  )
}

// Legacy МИС: замена = штраф objections; интеграция = успех
{
  const bad = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, это Тихон из ДентаCRM. Удобно минуту?',
      'Сколько неявок в неделю?',
      'Давайте заменим вашу 1С на нашу CRM — переедете полностью.',
    ],
    intentLog: [
      {
        intentId: 'greeting',
        managerQuote: 'Добрый день, это Тихон из ДентаCRM. Удобно минуту?',
        stage: 'contact',
        fsmStage: 'intro',
      },
      {
        intentId: 'need_discovery',
        managerQuote: 'Сколько неявок в неделю?',
        stage: 'discovery',
        fsmStage: 'discovery',
      },
      {
        intentId: 'trust_competitors',
        managerQuote:
          'Давайте заменим вашу 1С на нашу CRM — переедете полностью.',
        stage: 'objections',
        fsmStage: 'objection',
      },
    ],
    dialogueState: {
      stage: 'objection',
      slots: { legacyCrmRaised: true, replacementPitchError: true },
    },
  })
  const obj = bad.feedback.stageScores.find((s) => s.stageId === 'objections')
  assert(!!obj && obj.score < 6, 'legacy replacement → objections штраф')
  assert(
    bad.feedback.mistakes.some(
      (m) =>
        m.stageId === 'objections' && /замен|1[cс]|мис/i.test(m.comment ?? ''),
    ),
    'legacy replacement → ERROR карточка',
  )

  const good = analyzeRoleplayFeedback({
    managerMessages: [
      'Добрый день, это Тихон из ДентаCRM. Удобно минуту?',
      'Сколько неявок в неделю?',
      'Мы не меняем 1С — модуль в связке, интеграция поверх вашей МИС.',
    ],
    intentLog: [
      {
        intentId: 'greeting',
        managerQuote: 'Добрый день, это Тихон из ДентаCRM. Удобно минуту?',
        stage: 'contact',
        fsmStage: 'intro',
      },
      {
        intentId: 'need_discovery',
        managerQuote: 'Сколько неявок в неделю?',
        stage: 'discovery',
        fsmStage: 'discovery',
      },
      {
        intentId: 'trust_competitors',
        managerQuote:
          'Мы не меняем 1С — модуль в связке, интеграция поверх вашей МИС.',
        stage: 'objections',
        fsmStage: 'objection',
      },
    ],
    dialogueState: {
      stage: 'objection',
      slots: { legacyCrmRaised: true, integrationPitchOk: true },
    },
  })
  const objOk = good.feedback.stageScores.find((s) => s.stageId === 'objections')
  assert(!!objOk && objOk.score >= 7, 'legacy integration → objections OK')
  assert(
    (good.feedback.successes ?? []).some(
      (s) =>
        s.stageId === 'objections' && /интеграц|поверх|модул/i.test(s.comment ?? ''),
    ),
    'legacy integration → SUCCESS карточка',
  )
}

// Абстрактная выгода без метрик+цифр → presentation штраф
{
  const fb = analyzeRoleplayFeedback({
    managerMessages: [
      'Здравствуйте, я Тихон, ДентаCRM.',
      'Вам будет выгоднее и удобнее работать с нами.',
    ],
    intentLog: [
      {
        intentId: 'greeting',
        managerQuote: 'Здравствуйте, я Тихон, ДентаCRM.',
        stage: 'contact',
        fsmStage: 'intro',
      },
      {
        intentId: 'product_pitch_response',
        managerQuote: 'Вам будет выгоднее и удобнее работать с нами.',
        stage: 'presentation',
        fsmStage: 'presentation',
      },
    ],
  })
  const pres = fb.feedback.stageScores.find((s) => s.stageId === 'presentation')
  assert(!!pres && pres.score < 6, 'abstract benefit → presentation штраф')
}

console.log('\ndone, exitCode=', process.exitCode ?? 0)
