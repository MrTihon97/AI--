/**
 * Род голоса персоны + плейсхолдеры в шаблонах.
 *
 * В общих моках пишем маркеры, а не «поняла» намертво:
 *   «Про потери {понял}, давайте предметно.»
 *   «{Услышал} про CRM — это наше.»
 * fillGender() → понял/поняла по persona.gender.
 */

export type VoiceGender = 'm' | 'f'

/** Явный gender в данных клиента; fallback по id. */
const CLIENT_GENDER: Record<string, VoiceGender> = {
  marina: 'f',
  artem: 'm',
}

export function voiceGenderForClient(
  clientId?: string,
  explicit?: VoiceGender | null,
): VoiceGender {
  if (explicit === 'm' || explicit === 'f') return explicit
  if (clientId && CLIENT_GENDER[clientId]) return CLIENT_GENDER[clientId]!
  return 'f'
}

/**
 * Базовые формы (ключ = мужской). Капитализированный ключ → капитализированная форма.
 * Плейсхолдеры: {понял}/{Понял}, {услышал}/{Услышал}, {принял}/{Принял}, …
 */
const GENDER_FORMS: Record<string, Record<VoiceGender, string>> = {
  понял: { m: 'понял', f: 'поняла' },
  Понял: { m: 'Понял', f: 'Поняла' },
  услышал: { m: 'услышал', f: 'услышала' },
  Услышал: { m: 'Услышал', f: 'Услышала' },
  принял: { m: 'принял', f: 'приняла' },
  Принял: { m: 'Принял', f: 'Приняла' },
  расслышал: { m: 'расслышал', f: 'расслышала' },
  Расслышал: { m: 'Расслышал', f: 'Расслышала' },
  готов: { m: 'готов', f: 'готова' },
  Готов: { m: 'Готов', f: 'Готова' },
  рад: { m: 'рад', f: 'рада' },
  Рад: { m: 'Рад', f: 'Рада' },
  вынужден: { m: 'вынужден', f: 'вынуждена' },
  Вынужден: { m: 'Вынужден', f: 'Вынуждена' },
  записала: { m: 'записал', f: 'записала' },
  Записала: { m: 'Записал', f: 'Записала' },
}

const PLACEHOLDER_RE =
  /\{(Понял|понял|Услышал|услышал|Принял|принял|Расслышал|расслышал|Готов|готов|Рад|рад|Вынужден|вынужден|Записала|записала)\}/g

/** Подставить род в шаблон с плейсхолдерами `{понял}`, `{Услышал}`, … */
export function fillGender(template: string, gender: VoiceGender): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    const forms = GENDER_FORMS[key]
    return forms ? forms[gender] : match
  })
}

/**
 * Страховка для уже собранных реплик без плейсхолдеров:
 * женские глаголы → мужские (и наоборот), чтобы Артём не говорил «поняла».
 * Не используем `\b`: в JS граница слова не работает с кириллицей.
 */
export function enforceVoiceGender(text: string, gender: VoiceGender): string {
  if (gender === 'm') {
    return text
      .replace(/поняла/g, 'понял')
      .replace(/Поняла/g, 'Понял')
      .replace(/услышала/g, 'услышал')
      .replace(/Услышала/g, 'Услышал')
      .replace(/приняла/g, 'принял')
      .replace(/Приняла/g, 'Принял')
      .replace(/расслышала/g, 'расслышал')
      .replace(/Расслышала/g, 'Расслышал')
      .replace(/готова/g, 'готов')
      .replace(/Готова/g, 'Готов')
      .replace(/рада/g, 'рад')
      .replace(/Рада/g, 'Рад')
  }
  return text
    .replace(/понял(?!а)/g, 'поняла')
    .replace(/Понял(?!а)/g, 'Поняла')
    .replace(/услышал(?!а)/g, 'услышала')
    .replace(/Услышал(?!а)/g, 'Услышала')
    .replace(/принял(?!а)/g, 'приняла')
    .replace(/Принял(?!а)/g, 'Приняла')
    .replace(/расслышал(?!а)/g, 'расслышала')
    .replace(/Расслышал(?!а)/g, 'Расслышала')
    .replace(/готов(?!а|ый|ого|ому)/g, 'готова')
    .replace(/Готов(?!а|ый|ого|ому)/g, 'Готова')
    .replace(/рад(?!а|ы|ость)/g, 'рада')
    .replace(/Рад(?!а|ы|ость)/g, 'Рада')
}
