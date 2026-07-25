/**
 * Re-export NLU-сервиса (канон: src/dialogue/nlu.ts + training.ts).
 */
export {
  classifyIntent,
  resolveMultiIntent,
  warmNlu,
  type NluResult,
  type SalesStageHint,
} from '../dialogue/nlu'
export { TRAINING_DATA, type NluIntentId } from '../dialogue/training'
export { extractEntities, type MentionedEntity } from '../dialogue/entities'
