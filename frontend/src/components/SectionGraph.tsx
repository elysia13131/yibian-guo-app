import { useState, useEffect, useRef, useCallback } from 'react'
import GraphCanvas, { GraphData, GraphNode } from './GraphCanvas'
import { api } from '../api'

interface SectionGraphProps {
  documentId: string
  sectionId: string
}

const LEVEL_BADGE: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  L1: { label: '实体', dot: 'bg-blue-500', bg: 'bg-blue-100', text: 'text-blue-700' },
  L2: { label: '社区', dot: 'bg-emerald-500', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  L3: { label: '簇',   dot: 'bg-amber-500', bg: 'bg-amber-100', text: 'text-amber-700' },
}

export default function SectionGraph({ documentId, sectionId }: SectionGraphProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const prevSectionIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchGraph = useCallback(async () => {
    if (!documentId || !sectionId) return

    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setGraphData(null)

    try {
      const data = await api.get<any>(
        `/api/v1/graph/l1/${documentId}?section_id=${encodeURIComponent(sectionId)}`,
        controller.signal
      )
      if (!controller.signal.aborted) {
        const edges = (data.edges || []).map((e: any) => ({
          source: typeof e.source === 'object' ? (e.source as { id: string }).id : e.source,
          target: typeof e.target === 'object' ? (e.target as { id: string }).id : e.target,
          relation_type: e.relation_type,
        }))
        const nodes: GraphNode[] = (data.nodes || []).map((n: any) => ({
          id: n.metadata?.node_id || n.id || '',
          title: n.metadata?.title || n.title || '',
          content: n.content || n.metadata?.content || '',
          level: (n.metadata?.level as 'L1' | 'L2' | 'L3') || 'L1',
          community: n.metadata?.community || n.community,
          group: n.metadata?.group ?? n.group,
          memberCount: n.member_count ?? 0,
        }))
        setGraphData({ nodes, edges })
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      setError(err.message || '加载失败')
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [documentId, sectionId])

  useEffect(() => {
    if (sectionId !== prevSectionIdRef.current) {
      prevSectionIdRef.current = sectionId
      fetchGraph()
    }
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [sectionId, fetchGraph])

  const handleNodeClick = useCallback((node: GraphNode) => {
    setTooltip(prev => (prev?.node.id === node.id ? null : { node, x: 0, y: 0 }))
  }, [])

  const handleCloseTooltip = useCallback(() => {
    setTooltip(null)
  }, [])

  const nodeCount = graphData?.nodes.length ?? 0
  const edgeCount = graphData?.edges.length ?? 0

  // 级别统计
  const levelCounts = (() => {
    const c = { L1: 0, L2: 0, L3: 0 }
    if (!graphData) return c
    for (const n of graphData.nodes) {
      const lv = n.level || 'L1'
      if (c[lv] !== undefined) c[lv]++
    }
    return c
  })()

  return (
    <div className="bg-white rounded-2xl border border-stone-200/80 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* 头部 */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-400 to-blue-500 flex items-center justify-center shadow-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
              <line x1="12" y1="6.5" x2="12" y2="9" />
              <line x1="12" y1="15" x2="12" y2="17.5" />
              <line x1="6.5" y1="12" x2="9" y2="12" />
              <line x1="15" y1="12" x2="17.5" y2="12" />
            </svg>
          </div>
          <div>
            <span className="text-sm font-semibold text-stone-800">知识点图谱</span>
            {graphData && (
              <div className="flex items-center gap-2 mt-0.5">
                {Object.entries(levelCounts).filter(([, c]) => c > 0).map(([lv, cnt]) => (
                  <span key={lv} className="flex items-center gap-1 text-[11px] text-stone-400">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                      lv === 'L1' ? 'bg-blue-400' : lv === 'L2' ? 'bg-emerald-400' : 'bg-amber-400'
                    }`} />
                    {LEVEL_BADGE[lv].label} {cnt}
                  </span>
                ))}
                <span className="text-stone-300 mx-0.5">·</span>
                <span className="text-[11px] text-stone-400">{edgeCount} 关系</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="relative">
        {loading && (
          <div className="flex items-center justify-center" style={{ height: 300 }}>
            <div className="flex items-center gap-2.5 text-stone-400 text-sm">
              <svg className="animate-spin h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>加载中...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center gap-3" style={{ height: 300 }}>
            <p className="text-sm text-red-500">加载失败</p>
            <p className="text-xs text-stone-400 max-w-xs text-center">{error}</p>
            <button
              onClick={fetchGraph}
              className="px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl hover:from-blue-600 hover:to-blue-700 shadow-sm transition-all"
            >
              重试
            </button>
          </div>
        )}

        {!loading && !error && graphData && graphData.nodes.length === 0 && (
          <div className="flex items-center justify-center text-sm text-stone-400" style={{ height: 300 }}>
            <div className="flex flex-col items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-stone-300">
                <circle cx="12" cy="12" r="3" />
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
              </svg>
              <span>该段落暂无知识点图谱</span>
            </div>
          </div>
        )}

        {!loading && !error && graphData && graphData.nodes.length > 0 && (
          <GraphCanvas
            data={graphData}
            onNodeClick={handleNodeClick}
            height={300}
            theme="light"
          />
        )}

        {/* 底部信息提示 */}
        {tooltip && (
          <div className="absolute bottom-3 left-3 right-3 bg-white/95 backdrop-blur-sm border border-stone-200 rounded-xl shadow-lg p-3.5 z-10 max-h-44 overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-sm font-semibold text-stone-800 truncate">{tooltip.node.title}</p>
                  {tooltip.node.level && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${LEVEL_BADGE[tooltip.node.level]?.bg || 'bg-stone-100'} ${LEVEL_BADGE[tooltip.node.level]?.text || 'text-stone-600'}`}>
                      <span className={`inline-block w-1 h-1 rounded-full ${LEVEL_BADGE[tooltip.node.level]?.dot || 'bg-stone-400'}`} />
                      {LEVEL_BADGE[tooltip.node.level]?.label || tooltip.node.level}
                    </span>
                  )}
                </div>
                {tooltip.node.content && (
                  <p className="text-xs text-stone-500 leading-relaxed line-clamp-3">{tooltip.node.content}</p>
                )}
              </div>
              <button
                onClick={handleCloseTooltip}
                className="shrink-0 w-5 h-5 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-400 hover:text-stone-600 transition-all"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
