/** Утилиты pacing без зависимостей от FSM. */

export function managerAskedQuestion(text: string): boolean {
  return /\?|что\s+скажете|как\s+у\s+вас|подскажите|скажите|верно\s+ли|кто\s+вед[её]т|как\s+фиксир/i.test(
    text,
  )
}

export function nextMonoStreak(prev: number, userText: string): number {
  return managerAskedQuestion(userText) ? 0 : prev + 1
}
