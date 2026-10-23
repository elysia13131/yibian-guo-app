export type NotificationOrigin = 'task_result' | 'event'
export type NotificationMode = 'active' | 'passive'
export type TaskStatus = 'completed' | 'partial' | 'blocked' | 'failed' | 'cancelled'

const STATUS_PHRASE: Record<TaskStatus, { phrase: string; action: string }> = {
  completed: { phrase: '完成', action: '查看结果并回应' },
  partial: { phrase: '部分完成', action: '查看进度' },
  blocked: { phrase: '遇到阻碍', action: '检查问题' },
  failed: { phrase: '失败', action: '重试或告知原因' },
  cancelled: { phrase: '已取消', action: '无需处理' },
}

export function buildTaskResultActive(sourceName: string, status: TaskStatus, summary: string): string {
  const sp = STATUS_PHRASE[status]
  return `${sourceName}的任务已${sp.phrase}，请${sp.action}
 ✅ ${summary}`
}

export function buildTaskResultPassive(sourceName: string, summary: string): string {
  return `${sourceName}的任务结果:
 ✅ ${summary}`
}

export function buildEventActive(sourceName: string, summary: string): string {
  return `${sourceName}有了新消息，灵枢应该自然地回应:
 • ${summary}`
}

export function buildEventPassive(sourceName: string, summary: string): string {
  return `${sourceName}的消息:
 • ${summary}`
}

export function buildNotificationInject(
  origin: NotificationOrigin,
  mode: NotificationMode,
  status: TaskStatus,
  sourceName: string,
  summary: string,
  detail?: string,
): string {
  const detailSuffix = detail ? `\n${detail}` : ''
  if (origin === 'task_result') {
    return mode === 'active'
      ? buildTaskResultActive(sourceName, status, summary + detailSuffix)
      : buildTaskResultPassive(sourceName, summary + detailSuffix)
  }
  return mode === 'active'
    ? buildEventActive(sourceName, summary + detailSuffix)
    : buildEventPassive(sourceName, summary + detailSuffix)
}

export function buildAgentResultInject(goal: string, result: string): string {
  return `灵枢刚才帮你做的事情有结果了: ${goal}
结果: ${result}`
}

export function buildNotificationsInject(notifications: string[]): string {
  if (notifications.length === 0) return ''
  return `<notifications>\n${notifications.join('\n\n')}\n</notifications>`
}
