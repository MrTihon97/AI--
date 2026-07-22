import type { Zone } from '../types'

export function getZone(score: number): Zone {
  if (score < 5) return 'red'
  if (score <= 7) return 'yellow'
  return 'green'
}

export function zoneLabel(zone: Zone): string {
  switch (zone) {
    case 'red':
      return 'Красная зона'
    case 'yellow':
      return 'Жёлтая зона'
    case 'green':
      return 'Зелёная зона'
  }
}

/** Короткий бейдж на карточках / в истории */
export function zoneShortLabel(zone: Zone): string {
  switch (zone) {
    case 'red':
      return 'Красная'
    case 'yellow':
      return 'Жёлтая'
    case 'green':
      return 'Зелёная'
  }
}

/** Итог на экране разбора */
export function zoneResultLabel(zone: Zone): string {
  switch (zone) {
    case 'red':
      return 'Зона роста'
    case 'yellow':
      return 'Есть потенциал'
    case 'green':
      return 'Сильный результат'
  }
}

export function yesterdayIso(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function zoneBarClass(zone: Zone): string {
  switch (zone) {
    case 'red':
      return 'bg-rose-500'
    case 'yellow':
      return 'bg-amber-400'
    case 'green':
      return 'bg-emerald-500'
  }
}

export function zoneTextClass(zone: Zone): string {
  switch (zone) {
    case 'red':
      return 'text-rose-500'
    case 'yellow':
      return 'text-amber-500'
    case 'green':
      return 'text-emerald-500'
  }
}

export function zoneBadgeClass(zone: Zone): string {
  switch (zone) {
    case 'red':
      return 'bg-rose-50 text-rose-600 ring-rose-100'
    case 'yellow':
      return 'bg-amber-50 text-amber-600 ring-amber-100'
    case 'green':
      return 'bg-emerald-50 text-emerald-600 ring-emerald-100'
  }
}

export function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
