// Public API for the `tasks` domain module (ENGINEERING-02A boundary / 02B fill).
// Consumers import only from `@/modules/tasks` — never deep internal paths.
export { createTask } from './application/create-task';
export { submitTask } from './application/submit-task';
export { TaskRepository } from './repository/task-repository';
export type {
  CreateTaskInput,
  TaskContext,
  TaskStatus,
  TaskComplexity,
  TaskImpact,
} from './domain/types';
