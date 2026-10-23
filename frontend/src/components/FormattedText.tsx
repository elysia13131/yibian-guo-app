import { useMemo, useRef, useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/mhchem'

function MathFormula({ formula, displayMode }: { formula: string; displayMode?: boolean }) {
  const ref = useRef<HTMLSpanElement | HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) {
      try {
        katex.render(formula, ref.current, { displayMode: displayMode ?? false, throwOnError: false })
      } catch {
        ref.current.textContent = formula
      }
    }
  }, [formula, displayMode])
  if (displayMode) {
    return <div ref={ref as any} className="my-2 text-center" />
  }
  return <span ref={ref as any} className="inline-block align-middle" />
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

type InlinePart = string | { type: 'bold' | 'code' | 'math'; text: string; displayMode?: boolean } | { type: 'jump'; text: string; path: string }

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  const regex = /(\$\$(.+?)\$\$)|(\$(.+?)\$)|(\*\*(.+?)\*\*)|(`[^`]+`)|(\[JUMP_TO:\s*([^\]]+)\]\s*(.+?)(?=\s|$))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[1]) {
      parts.push({ type: 'math' as const, text: match[2], displayMode: true })
    } else if (match[3]) {
      parts.push({ type: 'math' as const, text: match[4], displayMode: false })
    } else if (match[5]) {
      parts.push({ type: 'bold' as const, text: match[6] })
    } else if (match[7]) {
      parts.push({ type: 'code' as const, text: match[7].slice(1, -1) })
    } else if (match[8]) {
      parts.push({ type: 'jump' as const, text: match[11].trim(), path: match[10].trim() })
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

interface FormattedTextProps {
  text: string
  navigate?: (path: string) => void
}

function InlineContent({ text, navigate }: { text: string; navigate?: (path: string) => void }) {
  const parts = useMemo(() => parseInline(text), [text])
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') {
          return <span key={i} dangerouslySetInnerHTML={{ __html: escapeHtml(p).replace(/\n/g, '<br/>') }} />
        }
        if (p.type === 'bold') return <strong key={i}>{p.text}</strong>
        if (p.type === 'code') return <code key={i} className="px-1 py-0.5 rounded bg-stone-100 text-stone-800 text-xs font-mono border border-stone-200">{p.text}</code>
        if (p.type === 'math') return <MathFormula key={i} formula={p.text} displayMode={p.displayMode} />
        if (p.type === 'jump' && navigate) {
          return (
            <button key={i} onClick={() => navigate(p.path!)}
              className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-50 to-orange-50 hover:from-amber-100 hover:to-orange-100 border border-amber-200 rounded-lg px-2.5 py-1 text-sm text-stone-700 transition-all mx-1"
            >
              <ExternalLink className="w-3 h-3 text-amber-500" />
              <span>{p.text}</span>
            </button>
          )
        }
        return <span key={i}>{p.text}</span>
      })}
    </>
  )
}

interface Props {
  content: string
  navigate?: (path: string) => void
}

export default function FormattedText({ content, navigate }: Props) {
  const blocks = useMemo(() => {
    const lines = content.split('\n')
    const blocks: { type: string; content: string[]; lang?: string }[] = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]

      // Display math block
      if (line.trimStart().startsWith('$$')) {
        const mathLines: string[] = []
        i++
        while (i < lines.length && !lines[i].trimStart().startsWith('$$')) {
          mathLines.push(lines[i])
          i++
        }
        i++
        blocks.push({ type: 'math-block', content: mathLines })
        continue
      }

      // Code block
      if (line.trimStart().startsWith('```')) {
        const lang = line.trimStart().slice(3).trim()
        const codeLines: string[] = []
        i++
        while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
          codeLines.push(lines[i])
          i++
        }
        i++
        blocks.push({ type: 'code', content: codeLines, lang: lang || undefined })
        continue
      }

      // Table
      if (line.trimStart().startsWith('|') && lines[i + 1]?.trimStart().startsWith('|') && lines[i + 1]?.includes('-')) {
        const tableLines: string[] = []
        while (i < lines.length && lines[i].trimStart().startsWith('|')) {
          tableLines.push(lines[i])
          i++
        }
        blocks.push({ type: 'table', content: tableLines })
        continue
      }

      // Heading
      const headingMatch = line.match(/^(#{2,4})\s+(.+)/)
      if (headingMatch) {
        blocks.push({ type: `h${headingMatch[1].length}` as any, content: [headingMatch[2]] })
        i++
        continue
      }

      // Unordered list
      if (line.trimStart().match(/^[-*]\s/)) {
        const listLines: string[] = []
        while (i < lines.length && lines[i].trimStart().match(/^[-*]\s/)) {
          listLines.push(lines[i].trimStart().replace(/^[-*]\s+/, ''))
          i++
        }
        blocks.push({ type: 'ul', content: listLines })
        continue
      }

      // Ordered list
      if (line.trimStart().match(/^\d+\.\s/)) {
        const listLines: string[] = []
        while (i < lines.length && lines[i].trimStart().match(/^\d+\.\s/)) {
          listLines.push(lines[i].trimStart().replace(/^\d+\.\s+/, ''))
          i++
        }
        blocks.push({ type: 'ol', content: listLines })
        continue
      }

      // Empty line
      if (line.trim() === '') {
        i++
        continue
      }

      // Paragraph
      const paraLines: string[] = []
      while (i < lines.length && lines[i].trim() !== '') {
        paraLines.push(lines[i])
        i++
      }
      blocks.push({ type: 'p', content: paraLines })
    }
    return blocks
  }, [content])

  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        if (block.type === 'p') {
          return (
            <p key={bi} className="text-sm leading-relaxed text-stone-700">
              {block.content.map((l, li) => (
                <span key={li}>
                  {li > 0 && <br />}
                  <InlineContent text={l} navigate={navigate} />
                </span>
              ))}
            </p>
          )
        }
        if (block.type === 'math-block') {
          const formula = block.content.join('\n')
          return <MathFormula key={bi} formula={formula} displayMode={true} />
        }
        if (block.type === 'h3') {
          return <h3 key={bi} className="text-base font-bold text-stone-800 mt-3 mb-1"><InlineContent text={block.content[0]} navigate={navigate} /></h3>
        }
        if (block.type === 'h4') {
          return <h4 key={bi} className="text-sm font-semibold text-stone-700 mt-2 mb-1"><InlineContent text={block.content[0]} navigate={navigate} /></h4>
        }
        if (block.type === 'ul') {
          return (
            <ul key={bi} className="list-disc list-inside space-y-0.5 text-sm text-stone-700">
              {block.content.map((item, li) => (
                <li key={li}><InlineContent text={item} navigate={navigate} /></li>
              ))}
            </ul>
          )
        }
        if (block.type === 'ol') {
          return (
            <ol key={bi} className="list-decimal list-inside space-y-0.5 text-sm text-stone-700">
              {block.content.map((item, li) => (
                <li key={li}><InlineContent text={item} navigate={navigate} /></li>
              ))}
            </ol>
          )
        }
        if (block.type === 'code') {
          return (
            <pre key={bi} className="bg-stone-900 text-stone-100 rounded-xl p-4 overflow-x-auto text-sm font-mono leading-relaxed">
              <code>{block.content.join('\n')}</code>
            </pre>
          )
        }
        if (block.type === 'table') {
          const rows = block.content.map(line =>
            line.trim().split('|').filter(Boolean).map(c => c.trim())
          )
          if (rows.length < 2) return null
          const [header, , ...dataRows] = rows
          return (
            <div key={bi} className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-stone-100">
                    {header.map((h, ci) => (
                      <th key={ci} className="border border-stone-200 px-3 py-1.5 text-left font-semibold text-stone-700">
                        <InlineContent text={h} navigate={navigate} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.map((row, ri) => (
                    <tr key={ri} className="even:bg-stone-50">
                      {row.map((cell, ci) => (
                        <td key={ci} className="border border-stone-200 px-3 py-1.5 text-stone-600">
                          <InlineContent text={cell} navigate={navigate} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
