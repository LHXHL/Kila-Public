import { bridgeManager } from './im-bridge/bridge-manager'
import { ScheduledTaskManager } from './scheduled-task-manager'

export const scheduledTaskManager = new ScheduledTaskManager({
  deliverScheduledTaskResult: (input) => bridgeManager.deliverScheduledTaskResult(input),
})
