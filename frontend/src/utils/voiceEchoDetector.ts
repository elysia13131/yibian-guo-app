function normalizeText(text: string): string {
  return text.replace(/[^\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '').toLowerCase()
}

interface MatchBlock {
  aStart: number
  bStart: number
  length: number
}

function similarityRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0

  const blocks: MatchBlock[] = []

  function findBlocks(astr: string, bstr: string, aOff: number, bOff: number): void {
    let bestLen = 0
    let bestA = -1
    let bestB = -1

    for (let i = 0; i < astr.length; i++) {
      for (let j = 0; j < bstr.length; j++) {
        let k = 0
        while (
          i + k < astr.length &&
          j + k < bstr.length &&
          astr[i + k] === bstr[j + k]
        ) {
          k++
        }
        if (k > bestLen) {
          bestLen = k
          bestA = i
          bestB = j
        }
      }
    }

    if (bestLen === 0) return

    findBlocks(astr.substring(0, bestA), bstr.substring(0, bestB), aOff, bOff)
    blocks.push({ aStart: aOff + bestA, bStart: bOff + bestB, length: bestLen })
    findBlocks(
      astr.substring(bestA + bestLen),
      bstr.substring(bestB + bestLen),
      aOff + bestA + bestLen,
      bOff + bestB + bestLen,
    )
  }

  findBlocks(a, b, 0, 0)

  let matchLen = 0
  for (const block of blocks) {
    matchLen += block.length
  }

  return (2 * matchLen) / (a.length + b.length)
}

export function looksLikeAiEcho(transcript: string, recentAiText: string, threshold = 0.88): boolean {
  const normTranscript = normalizeText(transcript)
  const normAiText = normalizeText(recentAiText)

  if (normTranscript.length < 6 || normAiText.length < 6) return false

  if (normAiText.includes(normTranscript)) return true

  const winLen = normTranscript.length
  let bestScore = 0

  for (let i = 0; i <= normAiText.length - winLen; i++) {
    const window = normAiText.substring(i, i + winLen)
    const score = similarityRatio(normTranscript, window)
    if (score > bestScore) {
      bestScore = score
    }
  }

  return bestScore >= threshold
}

export function shouldBargeIn(userInput: string, lastAiResponse: string, aiIsSpeaking: boolean): boolean {
  if (!aiIsSpeaking) return false
  if (looksLikeAiEcho(userInput, lastAiResponse)) return false
  return true
}
