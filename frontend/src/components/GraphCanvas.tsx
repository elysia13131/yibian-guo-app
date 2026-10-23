import { useRef, useEffect, useCallback } from 'react'

export interface GraphNode {
  id: string
  title: string
  content?: string
  level?: 'L1' | 'L2' | 'L3'
  community?: string
  group?: number
  memberCount?: number
  parentId?: string
  documentId?: number
  parents?: string[]
}

export interface GraphEdge {
  source: string
  target: string
  relation_type?: string
  inference_distance?: number
  hidden?: boolean  // true = 参与力模拟但不绘制
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface GraphCanvasProps {
  data: GraphData
  onNodeClick?: (node: GraphNode) => void
  width?: number
  height?: number
  showLabel?: boolean
  theme?: 'light' | 'dark'
  dimmedIds?: string[]
  focusNodeId?: string | null
  hiddenIds?: string[]        // 隐藏的节点（在模拟中但不绘制，也不参与物理）
}

interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  labelColor: string
}

const NODE_RADIUS = 8

// 级别色调映射：L1=蓝，L2=青绿，L3=琥珀暖色
const LEVEL_HUES: Record<string, number> = {
  L1: 220,
  L2: 165,
  L3: 35,
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`
}

function getNodeColor(_node: GraphNode, theme: 'light' | 'dark'): string {
  const hue = LEVEL_HUES[_node.level || 'L1'] ?? 220
  if (theme === 'dark') {
    const sat = _node.level === 'L3' ? 70 : 84
    const light = _node.level === 'L3' ? 82 : 77
    return hsl(hue, sat, light)
  }
  // 浅色主题
  const sat = _node.level === 'L3' ? 80 : 65
  const light = _node.level === 'L3' ? 70 : 60
  return hsl(hue, sat, light)
}

export default function GraphCanvas({
  data,
  onNodeClick,
  width: containerWidth,
  height: containerHeight,
  showLabel = true,
  theme = 'light',
  dimmedIds = [],
  focusNodeId = null,
  hiddenIds = [],
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<SimNode[]>([])
  const edgesRef = useRef<GraphEdge[]>([])
  const animationRef = useRef<number>(0)
  const mouseRef = useRef({ x: 0, y: 0, down: false, dragNode: null as SimNode | null, dragOffsetX: 0, dragOffsetY: 0 })
  const zoomRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const hoveredNodeRef = useRef<SimNode | null>(null)
  const clickedNodeRef = useRef<SimNode | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const focusAnimRef = useRef<{ startZoom: number; endZoom: number; startOx: number; endOx: number; startOy: number; endOy: number; frame: number; total: number } | null>(null)
  const dimmedSetRef = useRef<Set<string>>(new Set())
  const hiddenSetRef = useRef<Set<string>>(new Set())
  const highlightedNodeIdRef = useRef<string | null>(null)
  const touchRef = useRef({ startX: 0, startY: 0, startDist: 0, startZoom: 1, startOx: 0, startOy: 0, moved: false, lastTapTime: 0, singleTouch: false })

  const width = containerWidth ?? 600
  const height = containerHeight ?? 400

  dimmedSetRef.current = new Set(dimmedIds)
  hiddenSetRef.current = new Set(hiddenIds)

  const initializeSimulation = useCallback(() => {
    const existing = new Map(simRef.current.map(n => [n.id, n]))
    const newCount = data.nodes.length
    let newIndex = 0
    const simNodes: SimNode[] = data.nodes.map((node) => {
      const existingNode = existing.get(node.id)
      const nodeRadius = NODE_RADIUS
      // 已有节点：保留位置和速度，只更新属性
      if (existingNode) {
        existingNode.radius = nodeRadius
        existingNode.color = getNodeColor(node, theme)
        existingNode.labelColor = theme === 'dark' ? '#e5e7eb' : '#374151'
        // 更新可能变化的元数据
        existingNode.title = node.title
        existingNode.content = node.content
        existingNode.community = node.community
        existingNode.group = node.group
        existingNode.memberCount = node.memberCount
        return existingNode
      }
      // 新节点：从圆周上初始化
      const angle = (2 * Math.PI * newIndex) / Math.max(newCount, 1)
      const radius = Math.min(width, height) * 0.35
      const x = width / 2 + radius * Math.cos(angle) + (Math.random() - 0.5) * 20
      const y = height / 2 + radius * Math.sin(angle) + (Math.random() - 0.5) * 20
      newIndex++
      return {
        ...node,
        x,
        y,
        vx: 0,
        vy: 0,
        radius: nodeRadius,
        color: getNodeColor(node, theme),
        labelColor: theme === 'dark' ? '#e5e7eb' : '#374151',
      }
    })
    simRef.current = simNodes
    edgesRef.current = data.edges
  }, [data.nodes, data.edges, width, height, theme])

  const startFocusAnimation = useCallback((nodeId: string) => {
    const simNodes = simRef.current
    const node = simNodes.find(n => n.id === nodeId)
    if (!node) return

    const padding = 80
    const focusIds = new Set(dimmedSetRef.current)
    focusIds.delete(nodeId)
    const connectedIds = new Set<string>([nodeId])
    for (const edge of edgesRef.current) {
      const src = typeof edge.source === 'object' ? (edge.source as any).id : edge.source
      const tgt = typeof edge.target === 'object' ? (edge.target as any).id : edge.target
      if (src === nodeId) connectedIds.add(tgt)
      if (tgt === nodeId) connectedIds.add(src)
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of simNodes) {
      if (connectedIds.has(n.id)) {
        minX = Math.min(minX, n.x)
        maxX = Math.max(maxX, n.x)
        minY = Math.min(minY, n.y)
        maxY = Math.max(maxY, n.y)
      }
    }
    if (!isFinite(minX)) return

    const bw = maxX - minX + padding * 2
    const bh = maxY - minY + padding * 2
    const targetZoom = Math.min(width / bw, height / bh, 2.5)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const targetOx = width / 2 - cx * targetZoom
    const targetOy = height / 2 - cy * targetZoom

    focusAnimRef.current = {
      startZoom: zoomRef.current,
      endZoom: Math.max(targetZoom, 0.5),
      startOx: offsetRef.current.x,
      endOx: targetOx,
      startOy: offsetRef.current.y,
      endOy: targetOy,
      frame: 0,
      total: 30,
    }
  }, [width, height])

  useEffect(() => {
    if (focusNodeId) {
      setTimeout(() => startFocusAnimation(focusNodeId), 100)
    }
  }, [focusNodeId, startFocusAnimation])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const { x: ox, y: oy } = offsetRef.current
    const z = zoomRef.current

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    ctx.translate(ox, oy)
    ctx.scale(z, z)

    const simNodes = simRef.current
    const nodeMap = new Map(simNodes.map(n => [n.id, n]))
    const dimmed = dimmedSetRef.current
    const hidden = hiddenSetRef.current

    // ── 高亮集合 ──
    const highlightId = highlightedNodeIdRef.current
    let highlightSet = new Set<string>()
    let highlightEdges = new Set<number>()
    if (highlightId && nodeMap.has(highlightId)) {
      highlightSet.add(highlightId)
      edgesRef.current.forEach((edge, i) => {
        const src = typeof edge.source === 'object' ? (edge.source as any).id : edge.source
        const tgt = typeof edge.target === 'object' ? (edge.target as any).id : edge.target
        if (src === highlightId || tgt === highlightId) {
          if (src === highlightId) highlightSet.add(tgt)
          if (tgt === highlightId) highlightSet.add(src)
          highlightEdges.add(i)
        }
      })
    }
    const hasSelection = highlightSet.size > 0

    // 边颜色映射
    const edgeColors: Record<string, string> = {
      '包含': 'rgba(167,139,250,0.5)',
      '并列': 'rgba(96,165,250,0.5)',
      '前后置': 'rgba(52,211,153,0.5)',
      '父子': 'rgba(251,191,36,0.5)',
      '引用': 'rgba(248,113,113,0.5)',
    }
    const defaultEdgeColor = theme === 'dark' ? 'rgba(200,200,200,0.4)' : 'rgba(150,150,150,0.45)'
    const dimmedEdgeColor = 'rgba(200,200,200,0.08)'

    for (let ei = 0; ei < edgesRef.current.length; ei++) {
      const edge = edgesRef.current[ei]
      const source = typeof edge.source === 'object' ? (edge.source as any).id : edge.source
      const target = typeof edge.target === 'object' ? (edge.target as any).id : edge.target
      if (hidden.has(source) || hidden.has(target)) continue
      const sn = nodeMap.get(source)
      const tn = nodeMap.get(target)
      if (!sn || !tn) continue

      const edgeDimmed = (dimmed.has(source) || dimmed.has(target)) && !highlightEdges.has(ei)
      const edgeHighlighted = highlightEdges.has(ei)
      const relType = edge.relation_type || ''

      // ── 计算曲率 ──
      const dx = tn.x - sn.x
      const dy = tn.y - sn.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const CURVE_THRESHOLD = 80
      let cpx = 0, cpy = 0
      const curveAmount = dist > CURVE_THRESHOLD ? Math.min((dist - CURVE_THRESHOLD) * 0.004, 0.5) : 0
      const useCurve = curveAmount > 0.01

      if (useCurve) {
        const mx = (sn.x + tn.x) / 2
        const my = (sn.y + tn.y) / 2
        const nx = -dy / dist   // 垂直单位向量
        const ny = dx / dist
        const offset = curveAmount * dist
        cpx = mx + nx * offset
        cpy = my + ny * offset
      }

      // ── 箭头方向 ──
      // 对于曲线，使用切线方向（控制点→终点）；直线直接用 source→target 角度
      const arrowAngle = useCurve
        ? Math.atan2(tn.y - cpy, tn.x - cpx)
        : Math.atan2(tn.y - sn.y, tn.x - sn.x)
      const arrowSize = Math.max(14 / z, 8)
      const targetR = tn.radius || 8
      const tipX = tn.x - targetR * Math.cos(arrowAngle)
      const tipY = tn.y - targetR * Math.sin(arrowAngle)
      const lineEndX = tipX - arrowSize * 0.4 * Math.cos(arrowAngle)
      const lineEndY = tipY - arrowSize * 0.4 * Math.sin(arrowAngle)

      // ── 边颜色 ──
      let strokeColor: string
      if (edgeHighlighted) {
        strokeColor = 'rgba(239,68,68,0.7)'  // 红色
      } else if (edgeDimmed) {
        strokeColor = dimmedEdgeColor
      } else {
        strokeColor = edgeColors[relType] || defaultEdgeColor
      }

      // ── 绘制边 ──
      ctx.beginPath()
      if (useCurve) {
        ctx.moveTo(sn.x, sn.y)
        ctx.quadraticCurveTo(cpx, cpy, lineEndX, lineEndY)
      } else {
        ctx.moveTo(sn.x, sn.y)
        ctx.lineTo(lineEndX, lineEndY)
      }
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = edgeHighlighted ? Math.max(2.5 / z, 1) : Math.max(1.5 / z, 0.5)
      ctx.stroke()

      // ── 箭头 ──
      ctx.fillStyle = edgeHighlighted
        ? 'rgba(239,68,68,0.85)'
        : edgeDimmed
          ? dimmedEdgeColor
          : edgeColors[relType]?.replace('0.5', '0.8') || defaultEdgeColor.replace('0.4', '0.7').replace('0.45', '0.7')
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(
        tipX - arrowSize * 1.6 * Math.cos(arrowAngle - 0.35),
        tipY - arrowSize * 1.6 * Math.sin(arrowAngle - 0.35),
      )
      ctx.lineTo(
        tipX - arrowSize * 1.6 * Math.cos(arrowAngle + 0.35),
        tipY - arrowSize * 1.6 * Math.sin(arrowAngle + 0.35),
      )
      ctx.closePath()
      ctx.fill()

      // ── 关系标签 ──
      if (!edgeDimmed && relType && z > 0.5) {
        const mx = (sn.x + tn.x) / 2
        const my = (sn.y + tn.y) / 2
        ctx.font = `${Math.max(9, 10 / z)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const text = relType
        const textW = ctx.measureText(text).width
        const textH = 14 / z
        ctx.fillStyle = theme === 'dark' ? 'rgba(30,30,30,0.7)' : 'rgba(255,255,255,0.8)'
        ctx.fillRect(mx - textW / 2 - 2 / z, my - textH / 2, textW + 4 / z, textH)
        ctx.fillStyle = edgeHighlighted
          ? 'rgba(239,68,68,0.9)'
          : (edgeColors[relType]
            ? edgeColors[relType].replace('0.5', '0.9')
            : (theme === 'dark' ? 'rgba(200,200,200,0.6)' : 'rgba(100,100,100,0.7)'))
        ctx.fillText(text, mx, my)
      }
    }

    // ── 节点 ──
    for (const node of simNodes) {
      if (hidden.has(node.id)) continue

      const isHovered = hoveredNodeRef.current?.id === node.id
      const isDimmed = dimmed.has(node.id) && !isHovered
      const inHighlight = highlightSet.has(node.id)
      const isHighlighted = inHighlight && hasSelection
      const r = isHovered ? node.radius * 1.4 : node.radius

      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)

      if (isHighlighted) {
        // 高亮节点：红色
        ctx.fillStyle = 'rgba(239,68,68,0.85)'
      } else if (isDimmed) {
        ctx.fillStyle = theme === 'dark' ? 'rgba(100,100,100,0.15)' : 'rgba(200,200,200,0.2)'
      } else {
        ctx.fillStyle = node.color
      }
      ctx.fill()

      // 高亮节点外围光晕
      if (isHighlighted) {
        ctx.beginPath()
        ctx.arc(node.x, node.y, r + 2 / z, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(239,68,68,0.15)'
        ctx.lineWidth = 1 / z
        ctx.stroke()
      }

      if (isHovered) {
        ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.2)'
        ctx.lineWidth = 2 / z
        ctx.stroke()
      }

      if (showLabel && (isHovered || z > 0.8) && simNodes.length <= 500) {
        ctx.font = `${Math.max(11, 12 / z)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.fillStyle = isDimmed && !isHighlighted
          ? (theme === 'dark' ? 'rgba(150,150,150,0.3)' : 'rgba(200,200,200,0.3)')
          : node.labelColor
        ctx.fillText(node.title, node.x, node.y + r + 14 / z)
      }
    }
  }, [width, height, showLabel, theme])

  const simulate = useCallback((deltaMs: number) => {
    const simNodes = simRef.current
    if (simNodes.length === 0) return

    const dt = Math.min(deltaMs / 16, 3)
    const repulsion = 1200
    const attraction = 0.001
    const centerGravity = 0.002
    const damping = 0.85
    const minEnergy = 0.5
    const cx = width / 2
    const cy = height / 2

    const hidden = hiddenSetRef.current

    for (const node of simNodes) {
      if (mouseRef.current.dragNode === node) continue
      // 隐藏节点完全不参与物理模拟（相当于不存在）
      if (hidden.has(node.id)) continue

      let fx = 0
      let fy = 0

      // 斥力：跳过隐藏节点
      for (const other of simNodes) {
        if (other === node) continue
        if (hidden.has(other.id)) continue
        const dx = node.x - other.x
        const dy = node.y - other.y
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const force = repulsion / (dist * dist)
        fx += (dx / dist) * force
        fy += (dy / dist) * force
      }

      // 边引力：跳过连接到隐藏节点的边；传递边（inference_distance > 1）引力随距离衰减
      const edgeSource = edgesRef.current.filter(e => {
        const src = typeof e.source === 'object' ? (e.source as any).id : e.source
        return src === node.id
      })
      for (const edge of edgeSource) {
        const target = typeof edge.target === 'object' ? (edge.target as any).id : edge.target
        if (hidden.has(target)) continue
        const tn = simNodes.find(n => n.id === target)
        if (!tn) continue
        const dx = tn.x - node.x
        const dy = tn.y - node.y
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const infDist = edge.inference_distance || 1
        fx += (dx * attraction) / infDist
        fy += (dy * attraction) / infDist
      }

      const edgeTarget = edgesRef.current.filter(e => {
        const tgt = typeof e.target === 'object' ? (e.target as any).id : e.target
        return tgt === node.id
      })
      for (const edge of edgeTarget) {
        const source = typeof edge.source === 'object' ? (edge.source as any).id : edge.source
        if (hidden.has(source)) continue
        const sn = simNodes.find(n => n.id === source)
        if (!sn) continue
        const dx = sn.x - node.x
        const dy = sn.y - node.y
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const infDist = edge.inference_distance || 1
        fx += (dx * attraction) / infDist
        fy += (dy * attraction) / infDist
      }

      fx += (cx - node.x) * centerGravity
      fy += (cy - node.y) * centerGravity

      node.vx = (node.vx + fx) * damping
      node.vy = (node.vy + fy) * damping

      node.x += node.vx * dt
      node.y += node.vy * dt
    }

    const energy = simNodes.reduce((sum, n) => {
      if (hidden.has(n.id)) return sum
      return sum + Math.abs(n.vx) + Math.abs(n.vy)
    }, 0)
    if (energy < minEnergy && !mouseRef.current.down) {
      return true
    }
    return false
  }, [width, height])

  useEffect(() => {
    initializeSimulation()

    let lastTime = performance.now()

    const loop = (time: number) => {
      const delta = time - lastTime
      lastTime = time

      if (focusAnimRef.current) {
        const anim = focusAnimRef.current
        anim.frame++
        const t = Math.min(anim.frame / anim.total, 1)
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
        zoomRef.current = anim.startZoom + (anim.endZoom - anim.startZoom) * ease
        offsetRef.current.x = anim.startOx + (anim.endOx - anim.startOx) * ease
        offsetRef.current.y = anim.startOy + (anim.endOy - anim.startOy) * ease
        if (t >= 1) focusAnimRef.current = null
      }

      simulate(delta)

      if (mouseRef.current.dragNode) {
        const node = mouseRef.current.dragNode
        node.x = (mouseRef.current.x - offsetRef.current.x) / zoomRef.current
        node.y = (mouseRef.current.y - offsetRef.current.y) / zoomRef.current
      }

      draw()
      animationRef.current = requestAnimationFrame(loop)
    }

    animationRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animationRef.current)
  }, [initializeSimulation, simulate, draw])

  const getNodeAt = useCallback((sx: number, sy: number): SimNode | null => {
    const x = (sx - offsetRef.current.x) / zoomRef.current
    const y = (sy - offsetRef.current.y) / zoomRef.current
    const simNodes = simRef.current
    const hidden = hiddenSetRef.current
    for (let i = simNodes.length - 1; i >= 0; i--) {
      const node = simNodes[i]
      if (hidden.has(node.id)) continue
      const dx = x - node.x
      const dy = y - node.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist <= node.radius * 1.5) return node
    }
    return null
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    mouseRef.current.x = sx
    mouseRef.current.y = sy

    const node = getNodeAt(sx, sy)
    if (node) {
      mouseRef.current.down = true
      mouseRef.current.dragNode = node
      mouseRef.current.dragOffsetX = sx - node.x * zoomRef.current - offsetRef.current.x
      mouseRef.current.dragOffsetY = sy - node.y * zoomRef.current - offsetRef.current.y
      clickedNodeRef.current = node
      highlightedNodeIdRef.current = node.id
    } else {
      mouseRef.current.down = true
      mouseRef.current.dragNode = null
      clickedNodeRef.current = null
      highlightedNodeIdRef.current = null
    }
  }, [getNodeAt])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    // 先计算偏移，再更新坐标
    if (mouseRef.current.down && !mouseRef.current.dragNode) {
      offsetRef.current.x += sx - mouseRef.current.x
      offsetRef.current.y += sy - mouseRef.current.y
    }

    mouseRef.current.x = sx
    mouseRef.current.y = sy

    if (!mouseRef.current.down) {
      const node = getNodeAt(sx, sy)
      hoveredNodeRef.current = node
      const canvas = canvasRef.current
      if (canvas) {
        canvas.style.cursor = node ? 'pointer' : 'grab'
      }
    }

    if (mouseRef.current.dragNode) {
      const dist = Math.abs(sx - mouseRef.current.x) + Math.abs(sy - mouseRef.current.y)
      if (dist > 3) clickedNodeRef.current = null
    }
  }, [getNodeAt])

  const handleMouseUp = useCallback(() => {
    if (clickedNodeRef.current && onNodeClick) {
      onNodeClick(clickedNodeRef.current)
    }
    mouseRef.current.down = false
    mouseRef.current.dragNode = null
    clickedNodeRef.current = null
  }, [onNodeClick])

  // 使用非 passive 的 wheel 监听（React onWheel 默认 passive，preventDefault 失效）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.3, Math.min(4, zoomRef.current * factor))
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      offsetRef.current.x = mx - (mx - offsetRef.current.x) * (newZoom / zoomRef.current)
      offsetRef.current.y = my - (my - offsetRef.current.y) * (newZoom / zoomRef.current)
      zoomRef.current = newZoom
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    const touches = e.touches
    const t = touchRef.current
    t.moved = false

    if (touches.length === 1) {
      const sx = touches[0].clientX - rect.left
      const sy = touches[0].clientY - rect.top
      t.startX = sx
      t.startY = sy
      t.singleTouch = true

      const node = getNodeAt(sx, sy)
      if (node) {
        mouseRef.current.dragNode = node
        mouseRef.current.dragOffsetX = sx - node.x * zoomRef.current - offsetRef.current.x
        mouseRef.current.dragOffsetY = sy - node.y * zoomRef.current - offsetRef.current.y
        clickedNodeRef.current = node
      }
    } else if (touches.length === 2) {
      t.singleTouch = false
      mouseRef.current.dragNode = null
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      t.startDist = Math.sqrt(dx * dx + dy * dy)
      t.startZoom = zoomRef.current
      t.startOx = offsetRef.current.x
      t.startOy = offsetRef.current.y
      // 记录双指中点作为缩放中心
      const mx = (touches[0].clientX + touches[1].clientX) / 2 - rect.left
      const my = (touches[0].clientY + touches[1].clientY) / 2 - rect.top
      t.startX = mx
      t.startY = my
    }
  }, [getNodeAt])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    const touches = e.touches
    const t = touchRef.current

    if (touches.length === 1 && t.singleTouch) {
      const sx = touches[0].clientX - rect.left
      const sy = touches[0].clientY - rect.top
      const dx = sx - t.startX
      const dy = sy - t.startY

      if (mouseRef.current.dragNode) {
        // 拖拽节点
        const dist = Math.abs(sx - t.startX) + Math.abs(sy - t.startY)
        if (dist > 3) clickedNodeRef.current = null
        mouseRef.current.x = sx
        mouseRef.current.y = sy
        t.moved = true
      } else {
        // 拖拽画布
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) t.moved = true
        offsetRef.current.x += dx
        offsetRef.current.y += dy
        t.startX = sx
        t.startY = sy
      }
    } else if (touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (t.startDist > 0) {
        const scale = dist / t.startDist
        const newZoom = Math.max(0.3, Math.min(4, t.startZoom * scale))
        // 以双指中点为缩放中心
        const mx = (touches[0].clientX + touches[1].clientX) / 2 - rect.left
        const my = (touches[0].clientY + touches[1].clientY) / 2 - rect.top
        offsetRef.current.x = mx - (mx - t.startOx) * (newZoom / t.startZoom)
        offsetRef.current.y = my - (my - t.startOy) * (newZoom / t.startZoom)
        zoomRef.current = newZoom
      }
      t.moved = true
    }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const t = touchRef.current

    // 单击检测（没有移动 + 单指抬起）
    if (!t.moved && e.changedTouches.length === 1 && t.singleTouch) {
      const now = Date.now()
      // 双击检测（两次单击间隔 < 300ms）
      if (now - t.lastTapTime < 300) {
        // 双击重置缩放
        zoomRef.current = 1
        offsetRef.current.x = 0
        offsetRef.current.y = 0
        t.lastTapTime = 0
      } else {
        t.lastTapTime = now
        // 单击触发节点点击
        if (clickedNodeRef.current && onNodeClick) {
          onNodeClick(clickedNodeRef.current)
        }
      }
    }

    mouseRef.current.down = false
    mouseRef.current.dragNode = null
    clickedNodeRef.current = null
  }, [onNodeClick])

  return (
    <div
      ref={containerRef}
      style={{ width, height, position: 'relative', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        width={width * (window.devicePixelRatio || 1)}
        height={height * (window.devicePixelRatio || 1)}
        style={{ width, height, display: 'block', cursor: 'grab', background: theme === 'dark' ? '#1f2937' : '#ffffff' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    </div>
  )
}
