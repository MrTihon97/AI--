/**
 * Emotion Inertia: irritation не обнуляется за один хороший ход.
 */

type MoodLike = { irritation: number }

/** Максимальное охлаждение при irritation > 5 за один успешный ход. */
export const IRRITATION_COOL_CAP_WHEN_HIGH = 2

export function coolIrritationWithInertia(
  mood: MoodLike,
  requestedCool: number,
): number {
  if (requestedCool <= 0) return 0
  const before = mood.irritation
  const cool =
    before > 5
      ? Math.min(IRRITATION_COOL_CAP_WHEN_HIGH, requestedCool)
      : requestedCool
  mood.irritation = Math.min(10, Math.max(0, before - cool))
  return cool
}

export function heatIrritation(mood: MoodLike, amount: number): void {
  if (amount <= 0) return
  mood.irritation = Math.min(10, Math.max(0, mood.irritation + amount))
}

export function needsRestrainedAck(irritation: number): boolean {
  return irritation > 5
}
