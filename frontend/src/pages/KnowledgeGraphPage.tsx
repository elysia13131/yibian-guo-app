import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, X, Layers, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import GraphCanvas, { GraphNode, GraphData } from '../components/GraphCanvas'

const LEVEL_META: Record<string, { label: string; color: string; bg: string }> = {
  L1: { label: '实体', color: 'text-blue-700', bg: 'bg-blue-100' },
  L2: { label: '社区', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  L3: { label: '簇',   color: 'text-amber-700', bg: 'bg-amber-100' },
}

const LEVEL_ORDER: Record<string, number> = { L1: 1, L2: 2, L3: 3 }

export default function KnowledgeGraphPage() {
  const navigate = useNavigate()
  const [loadingOverlay, setLoadingOverlay] = useState(true)
  const [loadingStatus, setLoadingStatus] = useState('加载知识图谱...')
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [documentTitles, setDocumentTitles] = useState<Record<number, string>>({})

  const [allNodes, setAllNodes] = useState<GraphNode[]>([])
  const [allEdges, setAllEdges] = useState<GraphData['edges']>([])
  const [resultTruncated, setResultTruncated] = useState(false)

  const [focusedNodeId] = useState<string | null>(null)
  const [buildingDocs, setBuildingDocs] = useState<number[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const fetchDataRef = useRef<() => void>(() => {})

  const fetchGraphData = useCallback(async () => {
    setError(null)
    setLoadingOverlay(true)
    setLoadingStatus('获取图谱数据...')
    try {
      // Stage 0: 检查是否有数据
      const statsRes = await api.get<any>('/api/v1/graph/stats')
      const docCount = statsRes?.total_documents || 0
      if (docCount === 0) {
        setAllNodes([])
        setAllEdges([])
        setLoadingOverlay(false)
        return
      }

      // Stage 1: 全量跨文档节点数据（不限制级别，全局图谱）
      setLoadingStatus('加载节点...')
      const allDocs = await api.get<any>('/api/v1/graph/search?q=&limit=50000')
      const allItems = allDocs?.results || []

      const rawNodes: GraphNode[] = allItems
        .filter((n: any) => n.metadata?.node_type === 'entity')
        .map((n: any) => {
          let parents: string[] = []
          try {
            const raw = n.metadata?.parents
            if (raw) parents = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw))
          } catch {}
          return {
            id: n.metadata?.node_id || n.id || '',
            title: n.metadata?.title || n.title || '',
            content: n.content || n.metadata?.content || '',
            level: (n.metadata?.level as 'L1' | 'L2' | 'L3') || 'L1',
            community: n.metadata?.community || n.community,
            group: n.metadata?.group ?? n.group,
            memberCount: n.member_count ?? 0,
            documentId: parseInt(n.metadata?.document_id) || 0,
            parents,
          }
        })

      // id 去重（同 id 保留高层级节点）
      const dedupMap = new Map<string, GraphNode>()
      const removedIds = new Set<string>()
      for (const node of rawNodes) {
        const existing = dedupMap.get(node.id)
        if (!existing || (LEVEL_ORDER[node.level] || 0) > (LEVEL_ORDER[existing.level] || 0)) {
          dedupMap.set(node.id, node)
        }
      }
      const nodes = [...dedupMap.values()]
      const allNodeIds = nodes.map(n => n.id)

      setAllNodes(nodes)
      setResultTruncated(allItems.length >= 50000 || nodes.length >= 50000)

      // Stage 2: 批量查询边
      setLoadingStatus('加载关系...')
      const edgeRes = await api.post<any>('/api/v1/graph/edges/batch', { node_ids: allNodeIds })
      const rawEdges = edgeRes?.edges || []
      const edges: GraphData['edges'] = []
      for (const rel of rawEdges) {
        const src = rel.metadata?.source_id || ''
        const tgt = rel.metadata?.target_id || ''
        if (!removedIds.has(src) && !removedIds.has(tgt) && src && tgt) {
          edges.push({
            source: src,
            target: tgt,
            relation_type: rel.metadata?.relation_type || '',
          })
        }
      }

      const edgeSet = new Set<string>()
      const uniqueEdges = edges.filter(e => {
        const key = `${e.source}->${e.target}`
        if (edgeSet.has(key)) return false
        edgeSet.add(key)
        return true
      })

      setAllEdges(uniqueEdges)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载知识图谱失败')
    } finally {
      setLoadingOverlay(false)
    }
  }, [])

  fetchDataRef.current = fetchGraphData

  useEffect(() => {
    fetchGraphData()
  }, [fetchGraphData])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/v1/graph/ws/events`
    try {
      const ws = new WebSocket(wsUrl)
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'graph_build_start') {
            setBuildingDocs(prev => prev.includes(msg.document_id) ? prev : [...prev, msg.document_id])
          } else if (msg.type === 'graph_build_complete') {
            setBuildingDocs(prev => prev.filter(d => d !== msg.document_id))
            fetchDataRef.current()
          } else if (msg.type === 'graph_build_error') {
            setBuildingDocs(prev => prev.filter(d => d !== msg.document_id))
          }
        } catch {}
      }
      ws.onclose = () => { wsRef.current = null }
      wsRef.current = ws
    } catch {}
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node)
  }, [])

  const handleCloseDetail = () => setSelectedNode(null)

  // 选中节点时获取所有来源文档的标题
  useEffect(() => {
    if (!selectedNode?.parents?.length) return
    const needed = new Set<number>()
    for (const p of selectedNode.parents) {
      const parts = p.split(':')
      const did = parseInt(parts[0])
      if (did && !documentTitles[did]) needed.add(did)
    }
    // 也兼容旧格式（无 ":" 前缀）
    const nodeDid = selectedNode.documentId
    if (nodeDid && nodeDid !== 0 && !documentTitles[nodeDid]) needed.add(nodeDid)
    if (needed.size === 0) return
    ;[...needed].forEach(async (did) => {
      try {
        const res = await api.get<any>(`/api/v1/documents/${did}`)
        if (res?.title) setDocumentTitles(prev => ({ ...prev, [did]: res.title }))
      } catch {}
    })
  }, [selectedNode, documentTitles])

  // 搜索过滤
  const searchFilteredIds = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.trim().toLowerCase()
    const matched = new Set(allNodes.filter(n => n.title.toLowerCase().includes(q)).map(n => n.id))
    return allNodes.filter(n => !matched.has(n.id)).map(n => n.id)
  }, [searchQuery, allNodes])

  // 出边（指向）和入边（被指向）
  const outgoingEdges = useMemo(() => {
    if (!selectedNode || !allNodes.length) return [] as { node: GraphNode; relation: string }[]
    const result: { node: GraphNode; relation: string }[] = []
    for (const edge of allEdges) {
      if (edge.source === selectedNode.id) {
        const node = allNodes.find(n => n.id === edge.target)
        if (node) result.push({ node, relation: edge.relation_type || '关联' })
      }
    }
    return result
  }, [selectedNode, allNodes, allEdges])

  const incomingEdges = useMemo(() => {
    if (!selectedNode || !allNodes.length) return [] as { node: GraphNode; relation: string }[]
    const result: { node: GraphNode; relation: string }[] = []
    for (const edge of allEdges) {
      if (edge.target === selectedNode.id && edge.source !== selectedNode.id) {
        const node = allNodes.find(n => n.id === edge.source)
        if (node) result.push({ node, relation: edge.relation_type || '关联' })
      }
    }
    return result
  }, [selectedNode, allNodes, allEdges])

  const levelCounts = useMemo(() => {
    const c = { L1: 0, L2: 0, L3: 0 }
    for (const n of allNodes) {
      const lv = n.level || 'L3'
      if (c[lv] !== undefined) c[lv]++
    }
    return c
  }, [allNodes])

  const nodeLevelMeta = (node: GraphNode) => LEVEL_META[node.level || 'L3'] || LEVEL_META.L3

  // ---- 渲染 ----

  if (error && allNodes.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-50 via-white to-amber-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4 text-sm">{error}</p>
          <button
            onClick={fetchGraphData}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-xl transition-colors"
          >
            <RefreshCw size={16} />
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-stone-50 via-white to-amber-50 flex flex-col">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-md border-b border-stone-200/60 flex-shrink-0 sticky top-0 z-20">
        <div className="flex items-center justify-between h-14 px-6 max-w-screen-2xl mx-auto w-full">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center justify-center w-9 h-9 rounded-xl text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-sm">
                <Layers size={16} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-stone-800 tracking-wide">知识图谱</h1>
                  <span className="text-[11px] font-medium text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">L3 簇</span>
                </div>
                {allNodes.length > 0 && (
                  <div className="flex items-center gap-2 mt-0.5">
                    {Object.entries(levelCounts).filter(([, c]) => c > 0).map(([lv, cnt]) => (
                      <span key={lv} className="flex items-center gap-1 text-[11px] text-stone-400">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                          lv === 'L1' ? 'bg-blue-400' : lv === 'L2' ? 'bg-emerald-400' : 'bg-amber-400'
                        }`} />
                        {LEVEL_META[lv].label} {cnt}
                      </span>
                    ))}
                    <span className="text-stone-300 mx-0.5">·</span>
                    <span className="text-[11px] text-stone-400">{allEdges.length} 关系</span>
                  </div>
                )}
              </div>
            </div>
            {buildingDocs.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-50 px-2.5 py-1 rounded-lg">
                <RefreshCw size={12} className="animate-spin" />
                <span>构建中 ({buildingDocs.length})</span>
              </div>
            )}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索节点..."
              className="w-48 pl-9 pr-8 py-1.5 text-xs bg-stone-100 border border-stone-200 rounded-xl text-stone-700 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          {resultTruncated && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 shadow-sm flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
              <span>知识图谱数量已超过 50000，仅显示部分结果（约 {allNodes.length} 个节点）</span>
            </div>
          )}
          <GraphCanvas
            data={{ nodes: allNodes, edges: allEdges }}
            onNodeClick={handleNodeClick}
            width={window.innerWidth}
            height={window.innerHeight - 56}
            theme="light"
            hiddenIds={searchFilteredIds || []}
            dimmedIds={[]}
            focusNodeId={focusedNodeId}
          />
          {/* 加载指示器 */}
          {loadingOverlay && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
              <div className="flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur-sm border border-stone-200 rounded-xl shadow-lg">
                <Loader2 size={14} className="text-amber-400 animate-spin" />
                <span className="text-xs text-stone-500">{loadingStatus}</span>
              </div>
            </div>
          )}
          {/* 空数据提示 */}
          {!loadingOverlay && allNodes.length === 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
              <div className="flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur-sm border border-stone-200 rounded-xl shadow-lg">
                <Layers size={14} className="text-stone-300" />
                <span className="text-xs text-stone-500">暂无节点数据</span>
              </div>
            </div>
          )}
          {error && allNodes.length > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
              <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-xl shadow-lg">
                <span className="text-xs text-red-600">{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="text-stone-400 hover:text-stone-600"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 节点详情侧边栏 */}
      {selectedNode && (
        <div className="fixed top-14 right-0 bottom-0 z-40 w-96 pointer-events-none animate-slide-in">
          <div className="h-full bg-white/95 backdrop-blur-md border-l border-stone-200 shadow-2xl pointer-events-auto overflow-y-auto">
            <div className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-stone-200 px-5 py-4 flex items-center justify-between z-10">
              <h3 className="font-semibold text-stone-800 text-sm">节点详情</h3>
              <button
                onClick={handleCloseDetail}
                className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X size={15} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <h2 className="text-base font-bold text-stone-900 leading-snug mb-2">{selectedNode.title}</h2>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${nodeLevelMeta(selectedNode).bg} ${nodeLevelMeta(selectedNode).color}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                    selectedNode.level === 'L2' ? 'bg-emerald-500' :
                    selectedNode.level === 'L1' ? 'bg-blue-500' : 'bg-amber-500'
                  }`} />
                  {nodeLevelMeta(selectedNode).label}
                  {selectedNode.memberCount && selectedNode.memberCount > 1
                    ? ` (${selectedNode.memberCount})` : ''}
                </span>
              </div>

              {selectedNode.documentId && selectedNode.parents && selectedNode.parents.length > 0 && (() => {
                // 解析 parents: "docId:sectionId" 格式，兼容旧格式 "sectionId"
                const groups: Record<number, string[]> = {}
                for (const p of selectedNode.parents!) {
                  const parts = p.split(':')
                  let docId: number
                  let secId: string
                  if (parts.length >= 2) {
                    docId = parseInt(parts[0]) || selectedNode.documentId!
                    secId = parts.slice(1).join(':')
                  } else {
                    docId = selectedNode.documentId!
                    secId = p
                  }
                  if (!groups[docId]) groups[docId] = []
                  groups[docId].push(secId)
                }
                return (
                  <div>
                    <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 block">来源</label>
                    <div className="flex flex-col gap-2">
                      {Object.entries(groups).map(([didStr, secIds]) => {
                        const did = parseInt(didStr)
                        const docName = documentTitles[did]
                        return (
                          <div key={did}>
                            <p className="text-[11px] font-medium text-stone-500 mb-1 truncate">{docName || `文档 #${did}`}</p>
                            <div className="flex flex-wrap gap-1">
                              {secIds.map(secId => (
                                <button
                                  key={`${did}:${secId}`}
                                  onClick={() => window.open(`/documents/${did}?chapterId=${secId}`, '_blank')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200/60 rounded-lg transition-all"
                                >
                                  第 {secId} 节
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {selectedNode.content && (
                <div>
                  <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 block">描述</label>
                  <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-wrap line-clamp-8">
                    {selectedNode.content}
                  </p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-2 block">
                    指向 ({outgoingEdges.length})
                  </label>
                  {outgoingEdges.length > 0 ? (
                    <div className="space-y-1 max-h-96 overflow-y-auto">
                      {outgoingEdges.map(({ node, relation }) => (
                        <button
                          key={node.id}
                          onClick={() => setSelectedNode(node)}
                          className="w-full text-left px-3.5 py-2.5 rounded-xl bg-stone-50 hover:bg-stone-100 border border-stone-200/60 hover:border-stone-300 transition-all group"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-amber-500 flex-shrink-0 text-xs font-mono">→</span>
                            <span className="text-sm text-stone-700 truncate flex-1 group-hover:text-stone-900 transition-colors">{node.title}</span>
                            <span className="text-[11px] text-stone-400 flex-shrink-0 bg-stone-100 px-2 py-0.5 rounded-full">{relation}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : <p className="text-xs text-stone-400 italic">无</p>}
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-2 block">
                    被指向 ({incomingEdges.length})
                  </label>
                  {incomingEdges.length > 0 ? (
                    <div className="space-y-1 max-h-96 overflow-y-auto">
                      {incomingEdges.map(({ node, relation }) => (
                        <button
                          key={node.id}
                          onClick={() => setSelectedNode(node)}
                          className="w-full text-left px-3.5 py-2.5 rounded-xl bg-stone-50 hover:bg-stone-100 border border-stone-200/60 hover:border-stone-300 transition-all group"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-emerald-500 flex-shrink-0 text-xs font-mono">←</span>
                            <span className="text-sm text-stone-700 truncate flex-1 group-hover:text-stone-900 transition-colors">{node.title}</span>
                            <span className="text-[11px] text-stone-400 flex-shrink-0 bg-stone-100 px-2 py-0.5 rounded-full">{relation}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : <p className="text-xs text-stone-400 italic">无</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in {
          animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #d4d4d4;
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #bbb;
        }
      `}</style>
    </div>
  )
}
