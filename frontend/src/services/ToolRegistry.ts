export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
  handler?: ToolHandler
  metadata?: Record<string, any>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
  rawArguments?: string
}

export interface ToolResult {
  callId: string
  name: string
  output: any
  isError: boolean
  errorMessage: string
}

type ToolHandler = (args: Record<string, any>) => Promise<any> | any

export class ToolRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolRegistryError'
  }
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()
  private remoteDispatcher?: (call: ToolCall, metadata: Record<string, any>) => Promise<ToolResult>

  constructor(options?: { remoteDispatcher?: (call: ToolCall, metadata: Record<string, any>) => Promise<ToolResult> }) {
    if (options?.remoteDispatcher) {
      this.remoteDispatcher = options.remoteDispatcher
    }
  }

  register(tool: ToolDefinition, replace?: boolean): void {
    if (!tool.name) {
      throw new ToolRegistryError('Tool name is required')
    }
    if (this.tools.has(tool.name) && !replace) {
      throw new ToolRegistryError(`Tool "${tool.name}" is already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  names(): string[] {
    return Array.from(this.tools.keys())
  }

  all(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  clear(source?: string): number {
    if (source === undefined) {
      const count = this.tools.size
      this.tools.clear()
      return count
    }
    const toRemove: string[] = []
    for (const [name, tool] of this.tools) {
      if (tool.metadata?.source === source) {
        toRemove.push(name)
      }
    }
    for (const name of toRemove) {
      this.tools.delete(name)
    }
    return toRemove.length
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const tool = this.tools.get(call.name)
      if (!tool) {
        return {
          callId: call.id,
          name: call.name,
          output: null,
          isError: true,
          errorMessage: `Unknown tool: "${call.name}"`,
        }
      }

      if (tool.handler) {
        const output = await tool.handler(call.arguments)
        return {
          callId: call.id,
          name: call.name,
          output,
          isError: false,
          errorMessage: '',
        }
      }

      if (this.remoteDispatcher) {
        const metadata = tool.metadata ?? {}
        return await this.remoteDispatcher(call, metadata)
      }

      return {
        callId: call.id,
        name: call.name,
        output: null,
        isError: true,
        errorMessage: `Tool "${call.name}" has no handler and no remote dispatcher configured`,
      }
    } catch (err: any) {
      return {
        callId: call.id,
        name: call.name,
        output: null,
        isError: true,
        errorMessage: err.message ?? String(err),
      }
    }
  }

  specsForToolCall(): ToolDefinition[] {
    return this.all().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }
}
