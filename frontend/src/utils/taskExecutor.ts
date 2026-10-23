import { getAgentPlugin } from '../services/NekoAgentService'
import { NekoVisionService } from '../services/NekoVisionService'
import type { AgentStep } from '../types'

type OnStepUpdate = (step: AgentStep) => void

export class TaskExecutor {
  private vision: NekoVisionService
  private onStepUpdate: OnStepUpdate

  constructor(onStepUpdate: OnStepUpdate) {
    this.vision = new NekoVisionService()
    this.onStepUpdate = onStepUpdate
  }

  async execute(goal: string): Promise<string> {
    const agent = getAgentPlugin()

    const perm = await agent.checkAccessibilityPermission()
    if (!perm.enabled) {
      await agent.requestAccessibilityPermission()
      return '请先在系统设置中开启无障碍权限'
    }

    const plan = await this.plan(goal)
    if (!plan || plan.steps.length === 0) return '无法为此任务制定计划'

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]
      step.status = 'in_progress'
      this.onStepUpdate(step)

      try {
        const success = await this.executeStep(step)
        step.status = success ? 'completed' : 'failed'
        step.result = success ? '执行成功' : '执行失败'
        this.onStepUpdate(step)

        if (!success) {
          const fix = await this.replan(step, '上一步执行失败')
          if (fix) { plan.steps.splice(i + 1, 0, ...fix.steps); continue }
          break
        }
        await agent.waitForUI()
      } catch (e: any) {
        step.status = 'failed'
        step.result = e.message
        this.onStepUpdate(step)
        break
      }
    }
    return this.summarize(plan)
  }

  private async plan(goal: string): Promise<{ steps: any[] } | null> {
    const apiKey = localStorage.getItem('deepseek_api_key')
    if (!apiKey) return null
    const screen = await this.vision.captureAndDescribe()
    try {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: '根据用户目标和当前屏幕，制定手机操作步骤。可用操作：click(x,y), inputText(text), scroll(startX,startY,endX,endY), goBack(), goHome(), openApp(packageName), waitForUI()。输出 JSON {"steps": [{"action":"click","params":{"x":100,"y":200},"description":"点击搜索框"}]}' }, { role: 'user', content: `目标：${goal}\n当前屏幕：${screen.visionDescription}` }],
          max_tokens: 1000,
        }),
      })
      const data = await resp.json()
      const content = JSON.parse(data.choices?.[0]?.message?.content || '{}')
      if (!content.steps?.length) return null
      return {
        steps: content.steps.map((s: any, i: number) => ({ id: `step_${i}`, action: s.action, status: 'pending', description: s.description || s.action, params: s.params || {} }))
      }
    } catch { return null }
  }

  private async executeStep(step: any): Promise<boolean> {
    const agent = getAgentPlugin()
    const { action, params } = step
    try {
      switch (action) {
        case 'click': return (await agent.click({ x: params.x, y: params.y })).success
        case 'input': return (await agent.inputText({ text: params.text })).success
        case 'scroll': return (await agent.scroll({ startX: params.startX || 0, startY: params.startY || 0, endX: params.endX || 0, endY: params.endY || 0 })).success
        case 'back': return (await agent.goBack()).success
        case 'home': return (await agent.goHome()).success
        case 'openApp': return (await agent.openApp({ packageName: params.packageName })).success
        case 'wait': return (await agent.waitForUI()).success
        default: return false
      }
    } catch { return false }
  }

  private async replan(failedStep: any, reason: string): Promise<any> {
    const screen = await this.vision.captureAndDescribe()
    const apiKey = localStorage.getItem('deepseek_api_key')
    if (!apiKey) return null
    try {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: `步骤"${failedStep.description}"失败。原因：${reason}。当前屏幕：${screen.visionDescription}。请提供替代步骤。输出 JSON。` }],
          max_tokens: 500,
        }),
      })
      const data = await resp.json()
      const content = JSON.parse(data.choices?.[0]?.message?.content || '{}')
      if (!content.steps?.length) return null
      return { steps: content.steps.map((s: any, i: number) => ({ id: `refix_${Date.now()}_${i}`, action: s.action, status: 'pending', description: s.description || s.action })) }
    } catch { return null }
  }

  private summarize(plan: any): string {
    const ok = plan.steps.filter((s: any) => s.status === 'completed').length
    return ok === plan.steps.length ? '任务已完成！所有步骤执行成功。' : `任务部分完成（${ok}/${plan.steps.length}）`
  }
}
