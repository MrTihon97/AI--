/**
 * Детектор качественной экономики питча:
 * метрики стоматологии + конкретные цифры.
 */

export type ValueMetricFlags = {
  chair_occupancy: boolean
  patient_retention: boolean
  concrete_numbers: boolean
}

export type ValuePitchEvaluation = ValueMetricFlags & {
  /** Качественный value-pitch: (кресла|удержание) + цифры. */
  isHighQualityValue: boolean
}

const NORM = (t: string) => t.toLowerCase().replace(/ё/g, 'е')

/** Простой / загрузка кресел / окна приёма. */
const CHAIR_OCCUPANCY_RE =
  /(?:загрузк\w*\s+крес|крес\w*.{0,24}(?:загруз|прост|пуст|окн)|прост\w*\s+(?:крес|окон|при[её]м)|пуст\w*\s+окн|окн\w*\s+в\s+расписан|недозагруз|занятост\w*\s+крес|час\w*\s+прост)/i

/** Возврат / отвал / повторные визиты / неявки как удержание. */
const PATIENT_RETENTION_RE =
  /(?:возврат\w*\s+пациент|отвал\w*|повторн\w*\s+визит|повторн\w*\s+при[её]м|удержан\w*\s+пациент|неявк\w*|сорванн\w*\s+(?:визит|при[её]м)|потерянн\w*\s+пациент|lTV|повторн\w*\s+запис)/i

/** % / ₽ / дни / часы / штуки с числом. */
const CONCRETE_NUMBERS_RE =
  /(?:\d+[.,]?\d*\s*(?:%|проц|тыс\.?|тысяч|₽|руб|дн(?:я|ей|ь)?|час(?:а|ов)?|недел|мес)|(?:\+|−|-|минус|плюс)\s*\d+[.,]?\d*\s*(?:%|тыс|руб|пациент|визит|неявк)?|\d+\s*[-–—]\s*\d+\s*(?:%|тыс|руб|визит|неявк|крес))/i

export function evaluateValuePitch(text: string): ValuePitchEvaluation {
  if (!text?.trim()) {
    return {
      chair_occupancy: false,
      patient_retention: false,
      concrete_numbers: false,
      isHighQualityValue: false,
    }
  }
  const t = NORM(text)
  const chair_occupancy = CHAIR_OCCUPANCY_RE.test(t)
  const patient_retention = PATIENT_RETENTION_RE.test(t)
  const concrete_numbers = CONCRETE_NUMBERS_RE.test(t)
  const isHighQualityValue =
    concrete_numbers && (chair_occupancy || patient_retention)
  return {
    chair_occupancy,
    patient_retention,
    concrete_numbers,
    isHighQualityValue,
  }
}

/** Абстрактная «выгода» без метрик и цифр — не засчитываем как сильный питч. */
export function isAbstractBenefitOnly(text: string): boolean {
  if (!text?.trim()) return false
  const t = NORM(text)
  const abstract =
    /(?:выгод\w*|удобн\w*|сэконом\w*|лучш\w*\s+решен|повыси\w*\s+эффектив|оптимиз\w*|улучши\w*\s+(?:процесс|работ))/i.test(
      t,
    )
  if (!abstract) return false
  const ev = evaluateValuePitch(text)
  if (ev.isHighQualityValue) return false
  if (ev.chair_occupancy || ev.patient_retention || ev.concrete_numbers) {
    return false
  }
  return true
}
