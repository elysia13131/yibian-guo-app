const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/
const HAN_RE = /[\u4e00-\u9fff]/
const KANA_RE = /[\u3040-\u309f\u30a0-\u30ff]/
const WORD_RE = /\b[a-zA-Z]+\b/

export function stripMarkdown(text: string): string {
  let result = text

  result = result.replace(/```[\s\S]*?```/g, '')
  result = result.replace(/!\[.*?\]\(.*?\)/g, '')
  result = result.replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
  result = result.replace(/`([^`]*)`/g, '$1')
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1')
  result = result.replace(/__([^_]+)__/g, '$1')
  result = result.replace(/\*([^*]+)\*/g, '$1')
  result = result.replace(/~~([^~]+)~~/g, '$1')

  const lines = result.split('\n')
  const cleaned = lines.map(line => {
    let l = line
    l = l.replace(/^#{1,3}\s+/, '')
    l = l.replace(/^```\s*/, '')
    l = l.replace(/^-\s+/, '')
    l = l.replace(/^\d+\.\s+/, '')
    return l
  })
  return cleaned.join('\n').trim()
}

const OPENERS = '（([［【〈〔「『'
const CLOSERS = '）)]］】〉〕」』'
const PAIR_MAP: Record<string, string> = {
  '(': ')',
  '（': '）',
  '[': ']',
  '［': '］',
  '【': '】',
  '〈': '〉',
  '〔': '〕',
  '「': '」',
  '『': '』',
}

export class TtsBracketStripper {
  private depth = 0
  private buffer: string[] = []
  private stack: string[] = []

  feed(chunk: string): string {
    const out: string[] = []
    for (const ch of chunk) {
      if (OPENERS.includes(ch)) {
        this.depth++
        this.stack.push(ch)
        this.buffer.push(ch)
      } else if (CLOSERS.includes(ch)) {
        if (this.depth > 0) {
          const last = this.stack[this.stack.length - 1]
          const expected = PAIR_MAP[last]
          if (ch === expected) {
            this.depth--
            this.stack.pop()
            this.buffer.push(ch)
            if (this.depth === 0) {
              this.buffer = []
            }
          } else {
            if (this.depth === 0) {
              out.push(ch)
            } else {
              this.buffer.push(ch)
            }
          }
        } else {
          out.push(ch)
        }
      } else {
        if (this.depth === 0) {
          out.push(ch)
        } else {
          this.buffer.push(ch)
        }
      }
    }
    return out.join('')
  }

  flush(): string {
    if (this.depth > 0) {
      const content = this.buffer.join('')
      this.depth = 0
      this.buffer = []
      this.stack = []
      return content
    }
    return ''
  }
}

export function normalizeCJKSpaces(text: string): string {
  return text.replace(
    /(?<=[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]) +(?=[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])/g,
    '',
  )
}

const SENTENCE_END_RE = /(?<=[。！？.!?])/

export function splitParagraph(text: string, maxTokens = 100): string[] {
  if (!text) return []

  const rawSegments = text.split(SENTENCE_END_RE).map(s => s.trim()).filter(Boolean)
  const result: string[] = []

  for (const seg of rawSegments) {
    if (estimateTokens(seg) <= maxTokens) {
      result.push(seg)
    } else {
      const clauses = seg.split(/(?<=[，、；：,;:])/).map(s => s.trim()).filter(Boolean)
      for (const clause of clauses) {
        if (estimateTokens(clause) <= maxTokens) {
          result.push(clause)
        } else {
          let start = 0
          const chars = [...clause]
          while (start < chars.length) {
            let end = Math.min(start + maxTokens, chars.length)
            while (end > start && end < chars.length) {
              const piece = chars.slice(start, end).join('')
              if (estimateTokens(piece) <= maxTokens) break
              end--
            }
            result.push(chars.slice(start, end).join(''))
            start = end
          }
        }
      }
    }
  }

  return result
}

function estimateTokens(text: string): number {
  let tokens = 0
  for (const ch of text) {
    if (HAN_RE.test(ch) || KANA_RE.test(ch)) {
      tokens++
    }
  }
  const words = text.match(WORD_RE)
  if (words) {
    tokens += words.length
  }
  return tokens
}

export function estimateSpeechTime(text: string): number {
  const chineseCount = (text.match(HAN_RE) || []).length
  const kanaCount = (text.match(KANA_RE) || []).length
  const englishWordCount = (text.match(WORD_RE) || []).length

  const units = chineseCount * 1.5 + englishWordCount * 1.5 + kanaCount * 1.0
  return Math.round(units * 0.2 * 100) / 100
}

export class TtsPreprocessor {
  private bracketStripper = new TtsBracketStripper()

  process(text: string): string {
    let result = stripMarkdown(text)
    result = this.bracketStripper.feed(result)
    result = normalizeCJKSpaces(result)
    return result
  }

  processAndSplit(text: string, maxTokens?: number): string[] {
    const processed = this.process(text)
    return splitParagraph(processed, maxTokens)
  }

  reset(): void {
    this.bracketStripper.flush()
  }
}
