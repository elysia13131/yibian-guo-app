function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const time = `${hh}:${mm}`

  if (date >= todayStart) return time
  if (date >= yesterdayStart) return `昨天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function formatDateDivider(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)

  if (date >= todayStart) return '今天'
  if (date >= yesterdayStart) return '昨天'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function shouldShowDateDivider(currentTs: number, previousTs: number): boolean {
  const cur = new Date(currentTs)
  const pre = new Date(previousTs)
  return (
    cur.getFullYear() !== pre.getFullYear() ||
    cur.getMonth() !== pre.getMonth() ||
    cur.getDate() !== pre.getDate()
  )
}

export { formatMessageTime, formatDateDivider, shouldShowDateDivider }
