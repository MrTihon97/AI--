/** Сущности диалога — «крючки» памяти клиента. */
export type MentionedEntity =
  | 'whatsapp'
  | 'crm'
  | 'потери'
  | 'конверсия'
  | 'администратор'
  | 'цена'
  | 'неявки'
  | 'демо'
  | 'журнал'
  | 'филиалы'
  | 'интеграция'

const ENTITY_PATTERNS: Array<{ id: MentionedEntity; re: RegExp }> = [
  {
    id: 'whatsapp',
    re: /whatsapp|ватсап|вотсап|мессенджер|телеграм|instagram|инстаграм/i,
  },
  { id: 'crm', re: /\bcrm\b|дентаcrm|дента\s*crm|софт|систем[аыуе]/i },
  {
    // Конверсия / сквозная аналитика — ОТДЕЛЬНО от финансовых потерь
    id: 'конверсия',
    re: /конверси|звонк\w*\s*(?:в\s+)?запис|из\s+звонка\s+в\s+запис|сквозн\w*\s+аналитик|дашборд|live[\s-]?дашборд/i,
  },
  {
    // Без «конверси» — иначе bleed в «Про потери поняла»
    id: 'потери',
    re: /потер|теря|недополуча|упущенн|выручк|слива|недозвон|пропущен|не\s+перезвон|клиентск(ой|ую)\s+баз/i,
  },
  {
    id: 'администратор',
    re: /администратор|админ|ирина|сотрудник|персонал/i,
  },
  {
    id: 'цена',
    // Только явная денежная/прайсовая лексика. НЕ ловим «10-20%» и голое «подписка».
    re: /(?:цен[аыуе]|стоимост|прайс|тариф|бюджет|дорого|сколько\s+стоит|чо\s+по\s+цен|чё\s+по\s+цен)|(?:\d+[.,]?\d*\s*[–\-—]\s*\d+[.,]?\d*\s*(?:тыс\.?|тысяч|₽|руб))|(?:\d+[.,]?\d*\s*(?:тыс\.?|тысяч)\s*(?:₽|руб)?)|(?:\d+[.,]?\d*\s*₽)/i,
  },
  {
    id: 'неявки',
    re: /неявк|не\s+пришл|пуст(ые|ых)\s+окн|окна\s+в\s+расписан|отмен|не\s+дошл/i,
  },
  { id: 'демо', re: /демо|zoom|зуум|созвон|пилот|встреч|слот/i },
  {
    id: 'журнал',
    re: /журнал|excel|эксель|тетрад|бумаг|запис(и|ь|ей|ью)?\s+пациент|автоматиз/i,
  },
  { id: 'филиалы', re: /филиал|сеть|точек|клиник/i },
  {
    id: 'интеграция',
    re: /интеграц|телефони|api|1с|битрикс|медодс/i,
  },
]

export function extractEntities(text: string): MentionedEntity[] {
  const found: MentionedEntity[] = []
  for (const { id, re } of ENTITY_PATTERNS) {
    if (re.test(text) && !found.includes(id)) found.push(id)
  }
  // ₽ в расчёте потерь/выручки — не сущность «цена»
  if (
    found.includes('цена') &&
    isLossRevenueContext(text) &&
    !isSubscriptionPriceContext(text)
  ) {
    return found.filter((e) => e !== 'цена')
  }
  return found
}

export function mergeEntities(
  prev: MentionedEntity[],
  next: MentionedEntity[],
): MentionedEntity[] {
  const out = [...prev]
  for (const e of next) {
    if (!out.includes(e)) out.push(e)
  }
  return out.slice(-12)
}

/** Мягкие отсылки — без ложного «о которых вы спрашивали» на каждый ход. */
export const CONTEXT_HOOKS: Record<MentionedEntity, string[]> = {
  whatsapp: [
    'WhatsApp у нас узкое место. ',
    'По мессенджерам картина такая: ',
  ],
  crm: ['По CRM скажу прямо: ', 'По системе: '],
  // Без «Если про потери —» / мета-крючков
  потери: ['Да, по потерям картина такая: '],
  конверсия: ['По конверсии звонок→запись: '],
  администратор: ['По администратору: ', 'Про сотрудника на записи: '],
  цена: ['По стоимости: '],
  неявки: ['По неявкам: ', 'По пустым окнам: '],
  демо: ['По демо: ', 'По созвону: '],
  журнал: ['Про журнал: ', 'По учёту записи: '],
  филиалы: ['По филиалам: ', 'По сети: '],
  интеграция: ['По интеграции: ', 'По стыковке с текущим софтом: '],
}

export function pickContextHook(
  entities: MentionedEntity[],
  prefer: MentionedEntity[] | undefined,
  avoid?: MentionedEntity | null,
): { hook: string; entity: MentionedEntity } | null {
  const order = prefer?.length
    ? [...prefer.filter((e) => entities.includes(e)), ...entities]
    : entities
  const unique = [...new Set(order)].filter((e) => e !== avoid)
  for (const id of unique) {
    const hooks = (CONTEXT_HOOKS[id] ?? []).filter((h) => h.trim().length > 0)
    if (hooks.length) {
      return {
        entity: id,
        hook: hooks[Math.floor(Math.random() * hooks.length)]!,
      }
    }
  }
  return null
}

/** Денежные/метрические цифры, названные менеджером в сессии. */
export function extractMentionedFigures(text: string): string[] {
  if (!text?.trim()) return []
  const found: string[] = []
  const push = (s: string) => {
    const key = s.replace(/\s+/g, ' ').trim()
    if (key && !found.includes(key)) found.push(key)
  }

  // Вилка: 50–100 тыс / 30 000 – 50 000 ₽
  const range =
    /(\d+[.,]?\d*)\s*[–\-—]\s*(\d+[.,]?\d*)\s*(тыс\.?|тысяч|₽|руб)/gi
  let m: RegExpExecArray | null
  while ((m = range.exec(text)) !== null) {
    const unit = /тыс|тысяч/i.test(m[3]!) ? 'тысяч' : m[3]!
    push(`${m[1]}–${m[2]} ${unit}`)
  }

  // Одиночная: 50 тысяч / 50 000 ₽ / 15–25 тыс (уже поймано range) / 3000 рублей
  const single =
    /(\d+[.,]?\d*(?:\s+\d{3})*)\s*(тыс\.?|тысяч|₽|руб)/gi
  while ((m = single.exec(text)) !== null) {
    // Пропуск, если это правая/левая часть уже пойманной вилки
    const around = text.slice(Math.max(0, m.index - 4), m.index + m[0].length + 4)
    if (/[–\-—]/.test(around) && /(\d).*[–\-—].*(\d)/.test(around)) continue
    const raw = m[1]!.replace(/\s+/g, '')
    const unit = /тыс|тысяч/i.test(m[2]!) ? 'тысяч' : m[2]!
    push(`${raw} ${unit}`)
  }

  return found.slice(0, 8)
}

export function mergeMentionedFigures(
  prev: string[] | undefined,
  next: string[],
): string[] {
  const out = [...(prev ?? [])]
  for (const f of next) {
    if (!out.includes(f)) out.push(f)
  }
  return out.slice(-12)
}

/** В тексте реплики есть отсылка к конкретной цифре / цене / «таким цифрам». */
export const FIGURE_HALLUCINATION_RE =
  /(?:\d+[.,]?\d*\s*[–\-—]?\s*\d*[.,]?\d*\s*(?:тыс\.?|тысяч|₽|руб)|50\s*000|100\s*000|50\s*тысяч|100\s*тысяч|откуда\s+(?:такая\s+)?цифра|откуда\s+такие\s+цифр|без\s+экономик|сколько\s+стоит\s+эта\s+ваша|каждый\s+рубль\s+считаем)/i

export function sessionHasFigures(
  figures: string[] | undefined,
  currentUserText?: string,
): boolean {
  if (figures && figures.length > 0) return true
  if (currentUserText && extractMentionedFigures(currentUserText).length > 0) {
    return true
  }
  return false
}

/** Деньги про потери/выручку/ROI — не прайс подписки. */
export function isLossRevenueContext(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  return /(потер|теря|неявк|выручк|недополуча|упущенн|окупаем|\broi\b|сорванн\w*\s+при[её]м|чеке?\s+\d|заявк\w*\s+теря|пуст\w*\s+окн)/i.test(
    t,
  )
}

/** Явная цена подписки / тарифа. */
export function isSubscriptionPriceContext(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  return /(подписк|тариф|прайс|сколько\s+стоит|стоимост|цен[аыуе](\s|$)|выходит\s+(около|примерно|от)\s+\d|в\s+месяц\s+(от\s+)?\d|₽\s*\/\s*мес)/i.test(
    t,
  )
}

/** Менеджер сам назвал цену/вилку подписки (не потери в рублях!). */
export function managerStatedPrice(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  // «10–20%», «от 10 до 20%» — это потери, не прайс
  if (
    /\d+[.,]?\d*\s*%/.test(t) &&
    !/(₽|руб|тыс\.?|тысяч)/.test(t)
  ) {
    return false
  }
  if (
    /\d+[.,]?\d*\s*(?:до|[–\-—])\s*\d+[.,]?\d*\s*%/.test(t) &&
    !/(₽|руб|тыс)/.test(t)
  ) {
    return false
  }
  // «недополучает 50–100 тыс. ₽» / ROI на потерях — НЕ price objection
  if (isLossRevenueContext(t) && !isSubscriptionPriceContext(t)) {
    return false
  }
  // Нужна явная подписочная рамка ИЛИ «выходит … тыс» без loss-контекста
  const hasMoney =
    /(\d+[.,]?\d*)\s*[–\-—]\s*(\d+[.,]?\d*)\s*(тыс\.?|тысяч|₽|руб)/i.test(text) ||
    /(\d+[.,]?\d*)\s*(тыс\.?|тысяч|₽|руб)/i.test(text)
  if (!hasMoney) {
    if (
      /подписк\w*\s+(выходит|стоит|от)\s+\d+/i.test(text) &&
      /(₽|руб|тыс)/i.test(text)
    ) {
      return true
    }
    return false
  }
  // Деньги есть — только если это про подписку/тариф, не про потери
  if (isSubscriptionPriceContext(t)) return true
  if (
    /выходит\s+(около|примерно|от)\s+\d+/i.test(text) &&
    /(₽|руб|тыс)/i.test(text) &&
    !isLossRevenueContext(t)
  ) {
    return true
  }
  // Голая вилка «3000–5000 руб» без loss-слов — прайс
  if (
    /(\d+[.,]?\d*)\s*[–\-—]\s*(\d+[.,]?\d*)\s*(тыс\.?|тысяч|₽|руб)/i.test(text) &&
    !isLossRevenueContext(t)
  ) {
    return true
  }
  return false
}

/** Короткий ввод времени слота: «13:00», «16:00?», «в 15». */
export function isSlotTimeInput(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/ё/g, 'е')
  if (!t || t.length > 48) return false
  if (/^([01]?\d|2[0-3])\s*[:.\-]\s*[0-5]\d\s*[!?.…]*\s*$/.test(t)) return true
  if (/^(в\s+)?([01]?\d|2[0-3])\s*[:.\-]\s*[0-5]\d\s*[!?.…]*\s*$/.test(t)) {
    return true
  }
  if (
    /^(давайте|да|ок|окей|хорошо)?\s*,?\s*(в\s+)?([01]?\d|2[0-3])\s*[:.\-]\s*[0-5]\d\s*[!?.…]*\s*$/.test(
      t,
    )
  ) {
    return true
  }
  // «15» / «в 15» только как час (без лишнего текста)
  if (/^(в\s+)?([01]?\d|2[0-3])\s*(час(а|ов)?)?\s*[!?.…]*\s*$/.test(t)) {
    return true
  }
  return false
}

export function extractSlotTime(text: string): string | null {
  const m = text.match(/\b([01]?\d|2[0-3])\s*[:.\-]\s*([0-5]\d)\b/)
  if (m) return `${Number(m[1])}:${m[2]}`
  const h = text
    .trim()
    .toLowerCase()
    .match(/(?:^|\s)(?:в\s+)?([01]?\d|2[0-3])(?:\s*час|\s*[!?.…]*\s*$)/)
  if (h && isSlotTimeInput(text)) return `${Number(h[1])}:00`
  return null
}

/** День встречи: завтра / сегодня / день недели. */
export function hasSlotDay(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  return /(завтра|сегодня|послезавтра|в\s+понедельник|во\s+вторник|в\s+среду|в\s+четверг|в\s+пятниц|в\s+суббот|в\s+воскресен)/i.test(
    t,
  )
}

/** Час/минуты слота: «11:00», «в 11», «11 или 15» — не «на 10 минут». */
export function hasSlotClock(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  if (/\b([01]?\d|2[0-3])\s*[:.]\s*[0-5]\d\b/.test(t)) return true
  if (
    /(9|09|10|11|12|13|14|15|16|17|18|19)\s*или\s*(9|09|10|11|12|13|14|15|16|17|18|19)/i.test(
      t,
    )
  ) {
    return true
  }
  // «в 11» / «в 15 часов» — не длительность «на 10 минут»
  if (
    /(?:^|[^0-9a-zа-я])в\s+(9|09|10|11|12|13|14|15|16|17|18|19)(?:\s*(?:00|:00|часа|часов))?(?=$|[^0-9])/i.test(
      t,
    )
  ) {
    return true
  }
  return false
}

/**
 * Жёсткий next step: и день, и время (напр. «завтра в 11:00»).
 * Без этого сессию не закрываем.
 */
export function hasExplicitDateTimeSlot(text: string): boolean {
  if (!text?.trim()) return false
  return hasSlotDay(text) && hasSlotClock(text)
}

/**
 * Мягкое «договорились» без слота: WhatsApp «когда удобно», «пришлите ссылку».
 */
export function isFuzzyNextStep(text: string): boolean {
  if (!text?.trim()) return false
  if (hasExplicitDateTimeSlot(text)) return false
  const t = text.toLowerCase().replace(/ё/g, 'е')
  if (
    /(когда\s+удобно|в\s+удобное\s+время|наберите\s+когда|свяжемся\s+позже|напишите.{0,24}когда|когда.{0,16}напиш)/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /(напиш|пришл|скинь|отправ).{0,40}(whatsapp|ватсап|вотсап)/i.test(t) &&
    !hasSlotClock(t)
  ) {
    return true
  }
  // Zoom/демо без дня+времени
  if (
    /(демо|zoom|зуум|созвон|слот|встреч)/i.test(t) &&
    !hasExplicitDateTimeSlot(t)
  ) {
    return true
  }
  return false
}

/** Предложение демо / конкретного слота времени. */
export function offersDemoSlot(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е')
  if (isSlotTimeInput(text)) return true
  if (hasExplicitDateTimeSlot(text)) return true
  // Soft close («напишите когда удобно») — тоже closing-path, но без AGREED
  if (
    /(когда\s+удобно|в\s+удобное\s+время)/i.test(t) ||
    (/(напиш|пришл|скинь|отправ).{0,40}(whatsapp|ватсап|вотсап)/i.test(t) &&
      !hasSlotClock(t))
  ) {
    return true
  }
  const hasDemoWord =
    /(демо|zoom|зуум|созвон|пилот|слот|встреч|созвонимся|на\s+10\s+минут|на\s+15\s+минут|на\s+20\s+минут)/i.test(
      t,
    )
  const hasTime =
    /\b([01]?\d|2[0-3])\s*[:.]\s*[0-5]\d\b/.test(t) ||
    /(завтра|послезавтра|в\s+понедельник|во\s+вторник|после\s+обеда|утром|вечером)/i.test(
      t,
    ) ||
    /\b(11|12|13|14|15|16|17)\s*(00|часа|часов)?\b/.test(t)
  return hasDemoWord || (hasTime && /(минут|удобн|давайте|предлож|назначим)/i.test(t))
}
