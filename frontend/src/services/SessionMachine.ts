export type TurnOwner = 'none' | 'user' | 'proactive' | 'agent'
export type SessionPhase = 'idle' | 'responding' | 'proactive_phase1' | 'proactive_phase2' | 'committing'

export type SessionEventType =
  | 'user_input' | 'user_activity'
  | 'proactive_start' | 'proactive_claim' | 'proactive_phase2' | 'proactive_committing' | 'proactive_done'
  | 'agent_start' | 'agent_done'
  | 'playback_start' | 'playback_end'

export class SessionEvent {
  constructor(readonly type: SessionEventType, readonly payload?: Record<string, any>) {}
}

type Subscriber = (event: SessionEvent) => void

const PROACTIVE_ACTIVE_PHASES = new Set<SessionPhase>(['proactive_phase1', 'proactive_phase2', 'committing'])

export class SessionStateMachine {
  readonly name: string
  owner: TurnOwner = 'none'
  phase: SessionPhase = 'idle'
  proactiveSid: string | null = null
  userSid: string | null = null
  lastUserActivity: number = Date.now()
  isResponding: boolean = false
  private preempted: boolean = false
  private writeLock: boolean = false
  private subscribers: Map<SessionEventType | 'all', Subscriber[]> = new Map()
  private wildcardSubscribers: Subscriber[] = []

  constructor(name: string) { this.name = name }

  markUserInputPreempt(): void {
    if (PROACTIVE_ACTIVE_PHASES.has(this.phase)) this.preempted = true
  }

  isProactivePreempted(claimToken?: string | null): boolean {
    if (this.preempted) return true
    if (claimToken != null && this.proactiveSid != null && this.proactiveSid !== claimToken) return true
    return false
  }

  canStartProactive(session?: { isResponding: boolean }): boolean {
    if (this.phase !== 'idle') return false
    if (session?.isResponding) return false
    return true
  }

  async tryStartProactive(): Promise<boolean> {
    if (this.writeLock) return false
    this.writeLock = true
    try {
      if (!this.canStartProactive()) return false
      this.owner = 'proactive'
      this.phase = 'proactive_phase1'
      this.preempted = false
      this.proactiveSid = crypto.randomUUID()
      this.fire('proactive_start', { sid: this.proactiveSid })
      return true
    } finally {
      this.writeLock = false
    }
  }

  fire(event: SessionEventType, payload?: Record<string, any>): void {
    const evt = new SessionEvent(event, payload)
    this._apply(event, payload)
    const handlers = this.subscribers.get(event)
    if (handlers) for (const cb of handlers) cb(evt)
    const allHandlers = this.subscribers.get('all')
    if (allHandlers) for (const cb of allHandlers) cb(evt)
    for (const cb of this.wildcardSubscribers) cb(evt)
  }

  private _apply(event: SessionEventType, payload?: Record<string, any>): void {
    if (event === 'user_input') {
      if (PROACTIVE_ACTIVE_PHASES.has(this.phase)) this.preempted = true
      this.owner = 'user'
      this.userSid = payload?.sid || crypto.randomUUID()
      this.lastUserActivity = Date.now()
    } else if (event === 'user_activity') {
      this.lastUserActivity = Date.now()
    } else if (event === 'proactive_start') {
      this.owner = 'proactive'
      this.phase = 'proactive_phase1'
      this.preempted = false
      if (payload?.sid) this.proactiveSid = payload.sid
    } else if (event === 'proactive_claim') {
      if (this.phase === 'proactive_phase1' && !this.preempted) {
        if (payload?.sid) this.proactiveSid = payload.sid
      }
    } else if (event === 'proactive_phase2') {
      if (this.phase === 'proactive_phase1') this.phase = 'proactive_phase2'
    } else if (event === 'proactive_committing') {
      if (this.phase === 'proactive_phase2') this.phase = 'committing'
    } else if (event === 'proactive_done') {
      this.phase = 'idle'
      this.proactiveSid = null
      this.preempted = false
      if (this.owner === 'proactive') this.owner = 'none'
    } else if (event === 'agent_start') {
      this.owner = 'agent'
    } else if (event === 'agent_done') {
      if (this.owner === 'agent') this.owner = 'none'
    }
  }

  subscribe(event: SessionEventType | null, cb: Subscriber): () => void {
    if (event === null) {
      this.wildcardSubscribers.push(cb)
      return () => { const idx = this.wildcardSubscribers.indexOf(cb); if (idx !== -1) this.wildcardSubscribers.splice(idx, 1) }
    }
    const handlers = this.subscribers.get(event) ?? []
    handlers.push(cb)
    this.subscribers.set(event, handlers)
    return () => {
      const list = this.subscribers.get(event)
      if (!list) return
      const idx = list.indexOf(cb)
      if (idx !== -1) list.splice(idx, 1)
    }
  }

  reset(force: boolean = false): void {
    if (!force && PROACTIVE_ACTIVE_PHASES.has(this.phase)) return
    this.owner = 'none'
    this.phase = 'idle'
    this.proactiveSid = null
    this.userSid = null
    this.lastUserActivity = Date.now()
    this.isResponding = false
    this.preempted = false
  }

  snapshot(): Record<string, any> {
    return {
      name: this.name,
      owner: this.owner,
      phase: this.phase,
      proactiveSid: this.proactiveSid,
      userSid: this.userSid,
      preempted: this.preempted,
      lastUserActivity: this.lastUserActivity,
      isResponding: this.isResponding,
    }
  }
}

export class LifecycleEventBus {
  private subscribers: Map<string, Subscriber[]> = new Map()

  subscribe(event: string, handler: Subscriber): () => void {
    const handlers = this.subscribers.get(event) ?? []
    handlers.push(handler)
    this.subscribers.set(event, handlers)
    return () => {
      try { handlers.splice(handlers.indexOf(handler), 1) } catch {}
    }
  }

  emit(event: string, payload?: Record<string, any>): void {
    const evt = new SessionEvent(event as SessionEventType, payload)
    const handlers = this.subscribers.get(event)
    if (!handlers) return
    for (const cb of [...handlers]) {
      try { cb(evt) } catch {}
    }
  }

  off(event: string, handler: Subscriber): void {
    const handlers = this.subscribers.get(event)
    if (!handlers) return
    try { handlers.splice(handlers.indexOf(handler), 1) } catch {}
  }

  clear(): void { this.subscribers.clear() }
}
