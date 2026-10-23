import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Layers, Search, X, Loader2, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import { useDocument } from '../hooks/useDocuments'
import GraphCanvas from '../components/GraphCanvas'
import type { GraphNode, GraphData } from '../components/GraphCanvas'

const LEVEL_META: Record<string, { label: string; color: string; bg: string }> = {
  L1: { label: '实体', color: 'text-blue-700', bg: 'bg-blue-100' },
  L2: { label: '社区', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  L3: { label: '簇',   color: 'text-amber-700', bg: 'bg-amber-100' },
}

export default function DocumentGraph() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const docIdParam = searchParams.get('docId')
  const documentId = docIdParam ? parseInt(docIdParam) : 0

  const { data: documentData } = useDocument(documentId)
  const [loading, setLoading] = useState(true)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)

  const [allNodes, setAllNodes] = useState<GraphNode[]>([])
  const [allEdges, setAllEdges] = useState<GraphData['edges']>([])
  const [resultTruncated, setResultTruncated] = useState(false)

  useEffect(() => {
    if (!documentId) return

    const fetchGraph = async () => {
      setLoading(true)
      setLoadingStatus('加载节点...')
      setError(null)
      try {
        const l1Res = await api.get<any>(`/api/v1/graph/l1/${documentId}`)

        // 节点去重 + 保留级别信息
        const rawNodes: GraphNode[] = (l1Res.nodes || []).map((n: any) => {
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

        const dedupMap = new Map<string, GraphNode>()
        const removedIds = new Set<string>()
        for (const node of rawNodes) {
          if (dedupMap.has(node.title)) {
            removedIds.add(node.id)
          } else {
            dedupMap.set(node.title, node)
          }
        }

        const nodes = [...dedupMap.values()]
        setAllNodes(nodes)

        setLoadingStatus('加载关系...')
        const edges: GraphData['edges'] = (l1Res.edges || [])
          .map((e: any) => ({
            source: typeof e.source === 'object' ? (e.source as any).id : e.source,
            target: typeof e.target === 'object' ? (e.target as any).id : e.target,
            relation_type: e.relation_type,
          }))
          .filter((e: any) => !removedIds.has(e.source) && !removedIds.has(e.target))

        setAllEdges(edges)
        setResultTruncated(!!l1Res.truncated)

        // 统计各级别数量
        const counts = { L1: 0, L2: 0, L3: 0 }
        for (const n of nodes) {
          if (counts[n.level || 'L1'] !== undefined) counts[n.level || 'L1']++
        }
        const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${LEVEL_META[k].label} ${c}`)
        setLoadingStatus(parts.join(' · '))
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载知识图谱失败')
      } finally {
        setLoading(false)
      }
    }

    fetchGraph()
  }, [documentId])

  const searchFilteredIds = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.trim().toLowerCase()
    const matched = new Set(allNodes.filter(n => n.title.toLowerCase().includes(q)).map(n => n.id))
    return allNodes.filter(n => !matched.has(n.id)).map(n => n.id)
  }, [searchQuery, allNodes])

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node)
  }, [])

  const handleCloseDetail = () => setSelectedNode(null)

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

  // 统计
  const levelCounts = useMemo(() => {
    const c = { L1: 0, L2: 0, L3: 0 }
    for (const n of allNodes) {
      const lv = n.level || 'L1'
      if (c[lv] !== undefined) c[lv]++
    }
    return c
  }, [allNodes])

  // 节点级别的 badge 颜色
  const nodeLevelMeta = (node: GraphNode) => LEVEL_META[node.level || 'L1'] || LEVEL_META.L1

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-stone-50 via-white to-stone-50 flex flex-col">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-md border-b border-stone-200/60 flex-shrink-0 sticky top-0 z-20">
        <div className="flex items-center justify-between h-16 px-6 max-w-screen-2xl mx-auto w-full">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center justify-center w-9 h-9 rounded-xl text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                <Layers size={16} className="text-white" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-stone-800 leading-tight">
                  {documentData?.title || '知识图谱'}
                </h1>
                <div className="flex items-center gap-2 mt-0.5">
                  {!loading && allNodes.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
                      {Object.entries(levelCounts).filter(([,c]) => c > 0).map(([lv, cnt]) => (
                        <span key={lv} className="flex items-center gap-1">
                          <span className={`inline-block w-2 h-2 rounded-full ${
                            lv === 'L1' ? 'bg-blue-400' : lv === 'L2' ? 'bg-emerald-400' : 'bg-amber-400'
                          }`} />
                          {LEVEL_META[lv].label} {cnt}
                        </span>
                      ))}
                      <span className="text-stone-300 mx-0.5">·</span>
                      <span>{allEdges.length} 关系</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索节点..."
                className="w-48 pl-9 pr-8 py-2 text-xs bg-stone-100 border border-stone-200 rounded-xl text-stone-700 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>
            <Link
              to={`/documents/${documentId}`}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
            >
              <Layers size={14} />
              查看文档
            </Link>
          </div>
        </div>
      </header>

      {/* 画布区域 */}
      <div className="flex-1 relative">
        {resultTruncated && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 shadow-sm flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
            <span>文档节点数较多，仅显示前约 {allNodes.length} 个节点</span>
          </div>
        )}
        {loading && allNodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="text-blue-400 animate-spin" />
              <p className="text-sm text-stone-400">{loadingStatus || '加载中...'}</p>
            </div>
          </div>
        ) : error && allNodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-red-500 mb-3">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-xs font-medium text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
              >
                重试
              </button>
            </div>
          </div>
        ) : (
          <>
            <GraphCanvas
              data={{ nodes: allNodes, edges: allEdges }}
              onNodeClick={handleNodeClick}
              width={window.innerWidth}
              height={window.innerHeight - 64}
              hiddenIds={searchFilteredIds || []}
              dimmedIds={[]}
              focusNodeId={null}
              theme="light"
            />
            {/* 加载覆盖层 */}
            {loading && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
                <div className="flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur-sm border border-stone-200 rounded-xl shadow-lg">
                  <Loader2 size={14} className="text-blue-400 animate-spin" />
                  <span className="text-xs text-stone-500">{loadingStatus}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 节点详情面板 */}
      {selectedNode && (
        <div className="fixed top-16 right-0 bottom-0 z-40 w-96 pointer-events-none animate-slide-in">
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
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-base font-bold text-stone-900 leading-snug">{selectedNode.title}</h2>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${nodeLevelMeta(selectedNode).bg} ${nodeLevelMeta(selectedNode).color}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                    selectedNode.level === 'L2' ? 'bg-emerald-500' :
                    selectedNode.level === 'L3' ? 'bg-amber-500' : 'bg-blue-500'
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
                        const docName = did === selectedNode.documentId ? documentData?.title : ''
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
                            <span className="text-blue-500 flex-shrink-0 text-xs font-mono">→</span>
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
      `}</style>
    </div>
  )
}
