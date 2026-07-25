/**
 * Re-export FSM продажи (канон: src/dialogue/machine.ts).
 */
export {
  salesMachine,
  initialContext,
  applyManagerTurn,
  reduceTurn,
  markFollowUpAsked,
  withLastHook,
  withAskMemory,
  type DialogueContext,
  type DialogueSlots,
  type ClientMood,
  type SalesStage,
  type TurnInput,
} from '../dialogue/machine'
