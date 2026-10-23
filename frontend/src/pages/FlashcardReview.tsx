import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import BottomNav from '../components/BottomNav'
import { Flashcard, ReviewLog, CardGroup } from '../types'
import { ChevronLeft, ChevronRight, BookOpen } from 'lucide-react'
import { motion } from 'motion/react'
import PageTransition from '../components/PageTransition'
import katex from 'katex'
import 'katex/dist/katex.min.css'

function renderWithMath(text: string): string {
  let result = text
  // \[...\] display math
  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_, f) => {
    try { return katex.renderToString(f.trim(), { displayMode: true, throwOnError: false }) }
    catch { return `\\[${f}\\]` }
  })
  // $$...$$ display math
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => {
    try { return katex.renderToString(f.trim(), { displayMode: true, throwOnError: false }) }
    catch { return `$$${f}$$` }
  })
  // \(...\) inline math
  result = result.replace(/\\\(([\s\S]+?)\\\)/g, (_, f) => {
    try { return katex.renderToString(f.trim(), { displayMode: false, throwOnError: false }) }
    catch { return `\\(${f}\\)` }
  })
  // $...$ inline math
  result = result.replace(/\$([^$\n]+?)\$/g, (_, f) => {
    try { return katex.renderToString(f.trim(), { displayMode: false, throwOnError: false }) }
    catch { return `$${f}$` }
  })
  return result
}

function hasMath(text: string): boolean {
  return /\$/.test(text) || /\\\(/.test(text) || /\\\[/.test(text)
}

export default function FlashcardReview() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const groupId = searchParams.get('group')
  const navigate = useNavigate()
  const { token } = useAuth()
  const lastViewedCardIdRef = useRef<number | null>(null)

  const [flashcard, setFlashcard] = useState<Flashcard | null>(null)
  const [isFlipped, setIsFlipped] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [answerVerified, setAnswerVerified] = useState(false)
  const [reviewLogs, setReviewLogs] = useState<ReviewLog[]>([])
  const [reviewStartTime, setReviewStartTime] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [cards, setCards] = useState<Flashcard[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [group, setGroup] = useState<CardGroup | null>(null)
  const [isGroupReview, setIsGroupReview] = useState(false)

  // 为卡片生成唯一的key
  const getCardKey = (cardId: number) => {
    return `${groupId ? `group-${groupId}` : 'daily'}-card-${cardId}`
  }

  // 获取保存的选项
  const getSavedOptions = (cardId: number): string[] => {
    const key = getCardKey(cardId)
    const saved = sessionStorage.getItem(`${key}-options`)
    return saved ? JSON.parse(saved) : []
  }

  // 获取保存的验证状态
  const getSavedAnswerVerified = (cardId: number) => {
    const key = getCardKey(cardId)
    return sessionStorage.getItem(`${key}-verified`) === 'true'
  }

  // 保存选项
  const saveSelectedOptions = (cardId: number, options: string[]) => {
    const key = getCardKey(cardId)
    sessionStorage.setItem(`${key}-options`, JSON.stringify(options))
  }

  // 保存验证状态
  const saveAnswerVerified = (cardId: number, verified: boolean) => {
    const key = getCardKey(cardId)
    sessionStorage.setItem(`${key}-verified`, verified ? 'true' : 'false')
  }

  // 保存当前卡片位置
  const saveCurrentPosition = () => {
    if (groupId && flashcard) {
      sessionStorage.setItem(`lastCardGroup-${groupId}`, flashcard.id.toString())
    }
  }

  // 获取保存的卡片位置
  const getSavedPosition = () => {
    if (groupId) {
      return sessionStorage.getItem(`lastCardGroup-${groupId}`)
    }
    return null
  }

  const fetchCard = useCallback(async (cardId: number) => {
    try {
      const response = await api.get<Flashcard>(`/api/v1/flashcards/${cardId}`)
      setFlashcard(response)
      setIsFlipped(false)
      setShowAnswer(false)
      // 从sessionStorage恢复选择的选项和验证状态
      const savedOptions = getSavedOptions(cardId)
      const savedVerified = getSavedAnswerVerified(cardId)
      setSelectedOptions(savedOptions)
      setAnswerVerified(savedVerified)
      setReviewStartTime(new Date())
      lastViewedCardIdRef.current = cardId
    } catch (error) {
      console.error('获取抽认卡失败:', error)
    }
  }, [groupId])

  const fetchReviewLogs = useCallback(async (cardId: number) => {
    try {
      const response = await api.get<ReviewLog[]>(`/api/v1/flashcards/${cardId}/logs?limit=10`)
      setReviewLogs(response || [])
    } catch (error) {
      console.error('获取复习日志失败:', error)
    }
  }, [])

  const fetchGroup = useCallback(async (gId: string, targetCardId?: number) => {
    try {
      const response = await api.get<CardGroup & { flashcards: Flashcard[] }>(`/api/v1/flashcards/groups/${gId}`)
      setGroup(response)
      if (response.flashcards && response.flashcards.length > 0) {
        setCards(response.flashcards)

        let startIndex = 0
        // 优先使用传入的targetCardId
        if (targetCardId) {
          startIndex = response.flashcards.findIndex(c => c.id === targetCardId)
        } else {
          // 然后检查本地保存的位置
          const savedPosition = getSavedPosition()
          if (savedPosition) {
            startIndex = response.flashcards.findIndex(c => c.id === parseInt(savedPosition))
          } else if (id) {
            startIndex = response.flashcards.findIndex(c => c.id === parseInt(id))
          }
        }
        if (startIndex < 0) startIndex = 0

        setCurrentIndex(startIndex)
        setIsGroupReview(true)
        fetchCard(response.flashcards[startIndex].id)
        fetchReviewLogs(response.flashcards[startIndex].id)
      }
    } catch (error) {
      console.error('获取卡组失败:', error)
    }
  }, [id, fetchCard, fetchReviewLogs, getSavedPosition])

  const fetchDueCards = useCallback(async (targetCardId?: number) => {
    try {
      const response = await api.get<{ items: Flashcard[], total: number, due_today: number, overdue: number }>('/api/v1/flashcards/due?limit=100')
      if (response.items && response.items.length > 0) {
        setCards(response.items)

        let startIndex = 0
        if (targetCardId) {
          startIndex = response.items.findIndex(c => c.id === targetCardId)
          if (startIndex < 0) startIndex = 0
        } else if (id) {
          startIndex = response.items.findIndex(c => c.id === parseInt(id))
          if (startIndex < 0) startIndex = 0
        }

        setCurrentIndex(startIndex)
        setIsGroupReview(false)
        fetchCard(response.items[startIndex].id)
        fetchReviewLogs(response.items[startIndex].id)
      }
    } catch (error) {
      console.error('获取到期卡片失败:', error)
    }
  }, [id, fetchCard, fetchReviewLogs])

  useEffect(() => {
    if (!token) return

    const savedCardId = sessionStorage.getItem('lastViewedCardId')
    const shouldRestore = sessionStorage.getItem('restoreFlashcardPosition') === 'true'

    if (shouldRestore && savedCardId) {
      sessionStorage.removeItem('restoreFlashcardPosition')
      sessionStorage.removeItem('lastViewedCardId')

      if (groupId) {
        fetchGroup(groupId, parseInt(savedCardId))
      } else {
        fetchDueCards(parseInt(savedCardId))
      }
    } else {
      if (groupId) {
        fetchGroup(groupId)
      } else {
        fetchDueCards()
      }
    }

    setLoading(false)
  }, [token, groupId])

  const handleOptionSelect = (optionLabel: string) => {
    if (!flashcard || answerVerified) return

    if (flashcard.is_multiple) {
      // 多选题：可以选中多个
      setSelectedOptions(prev => {
        const newOptions = prev.includes(optionLabel)
          ? prev.filter(o => o !== optionLabel)
          : [...prev, optionLabel]
        saveSelectedOptions(flashcard.id, newOptions)
        saveAnswerVerified(flashcard.id, false)
        return newOptions
      })
    } else {
      // 单选题：只能选中一个
      setSelectedOptions([optionLabel])
      setAnswerVerified(false)
      saveSelectedOptions(flashcard.id, [optionLabel])
      saveAnswerVerified(flashcard.id, false)
    }
  }

  const handleShowAnswer = () => {
    setShowAnswer(true)
    setIsFlipped(true)
  }

  const handleRating = async (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!flashcard || submitting) return

    const durationSeconds = reviewStartTime 
      ? (new Date().getTime() - reviewStartTime.getTime()) / 1000
      : 0

    setSubmitting(true)
    try {
      await api.post(`/api/v1/flashcards/${flashcard.id}/review`, {
        rating,
        duration_seconds: durationSeconds
      })

      // 移动到下一张卡片
      if (currentIndex < cards.length - 1) {
        const nextIndex = currentIndex + 1
        setCurrentIndex(nextIndex)
        fetchCard(cards[nextIndex].id)
        fetchReviewLogs(cards[nextIndex].id)
      } else {
        // 没有更多卡片了
        navigate('/flashcards')
      }
    } catch (error: any) {
      console.error('提交复习失败:', error)
      alert(error.response?.data?.detail || '提交复习失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleBackToList = () => {
    saveCurrentPosition()
    navigate('/flashcards')
  }

  const handlePrevCard = () => {
    if (currentIndex > 0) {
      saveCurrentPosition()
      const prevIndex = currentIndex - 1
      setCurrentIndex(prevIndex)
      setIsFlipped(false)
      fetchCard(cards[prevIndex].id)
      fetchReviewLogs(cards[prevIndex].id)
    }
  }

  const handleNextCard = () => {
    if (currentIndex < cards.length - 1) {
      saveCurrentPosition()
      const nextIndex = currentIndex + 1
      setCurrentIndex(nextIndex)
      setIsFlipped(false)
      fetchCard(cards[nextIndex].id)
      fetchReviewLogs(cards[nextIndex].id)
    }
  }

  const handleViewDocument = () => {
    if (flashcard) {
      sessionStorage.setItem('lastViewedCardId', flashcard.id.toString())
      sessionStorage.setItem('restoreFlashcardPosition', 'true')
      navigate(`/documents/${flashcard.document_id}`)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    )
  }

  if (!flashcard) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-700 mb-4">抽认卡不存在</p>
          <button
            onClick={handleBackToList}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg"
          >
            返回抽认卡列表
          </button>
        </div>
      </div>
    )
  }

  return (
    <PageTransition>
      <motion.div
        className="min-h-screen pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
      <div className="container mx-auto px-4 py-6">
        {/* 顶部导航 */}
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={handleBackToList}
            className="text-gray-600 hover:text-gray-800 flex items-center gap-1"
          >
            <ChevronLeft className="w-5 h-5" />
            返回
          </button>
          <div className="text-sm text-gray-500">
            {group?.name || (isGroupReview ? '卡组复习' : '每日复习')} • {currentIndex + 1} / {cards.length}
          </div>
        </div>

        {/* 进度条 */}
        {cards.length > 0 && (
          <div className="mb-2">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-gray-500">复习进度</span>
              <span className="text-xs text-gray-500">{currentIndex + 1} / {cards.length}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* 进度信息 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex space-x-4 text-sm">
            <div className="bg-white px-3 py-1 rounded-full shadow">
              难度: <span className="font-medium">{flashcard.difficulty.toFixed(2)}</span>
            </div>
            <div className="bg-white px-3 py-1 rounded-full shadow">
              稳定性: <span className="font-medium">{flashcard.stability.toFixed(2)}</span>
            </div>
            <div className="bg-white px-3 py-1 rounded-full shadow">
              复习次数: <span className="font-medium">{flashcard.reps}</span>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            上次复习: {flashcard.last_reviewed ? new Date(flashcard.last_reviewed).toLocaleDateString('zh-CN') : '从未'}
          </div>
        </div>

        {/* 卡片容器 — 3D 翻转 */}
        <div className="max-w-2xl mx-auto mb-8" style={{ perspective: 1200 }}>
          <motion.div
            className="relative bg-white/85 backdrop-blur-sm rounded-2xl shadow-xl border border-stone-200"
            style={{ transformStyle: "preserve-3d" }}
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
          >
            {/* 问题面 */}
            {!isFlipped && (
              <div className="p-8">
                <div className="text-center flex flex-col justify-center">
                  <div className="mb-6">
                    <span className="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium mb-4">
                      {flashcard.is_multiple ? '多选题' : flashcard.is_multiple_choice ? '单选题' : '问答题'}
                    </span>
                    <h1 className="text-2xl font-bold text-gray-800 mb-6 leading-relaxed">
                      {hasMath(flashcard.question) ? (
                        <span dangerouslySetInnerHTML={{ __html: renderWithMath(flashcard.question) }} />
                      ) : (
                        flashcard.question
                      )}
                    </h1>
                  </div>

                  {/* 选择题选项 */}
                  {flashcard.is_multiple_choice && flashcard.options && !showAnswer && (
                    <div className="mb-6 space-y-3">
                      {flashcard.options.map((option) => {
                        const isSelected = selectedOptions.includes(option.label)
                        const correctLabels = flashcard.is_multiple
                          ? (flashcard.correct_option_labels || [])
                          : (flashcard.correct_option_label ? [flashcard.correct_option_label] : [])
                        const isCorrect = answerVerified && correctLabels.includes(option.label)
                        const isWrong = answerVerified && isSelected && !correctLabels.includes(option.label)

                        return (
                          <button
                            key={option.label}
                            onClick={() => handleOptionSelect(option.label)}
                            disabled={answerVerified}
                            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                              isCorrect
                                ? 'border-green-500 bg-green-50'
                                : isWrong
                                ? 'border-red-500 bg-red-50'
                                : isSelected
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                            } ${answerVerified ? 'cursor-default' : 'cursor-pointer'}`}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                                isCorrect
                                  ? 'bg-green-500 text-white'
                                  : isWrong
                                  ? 'bg-red-500 text-white'
                                  : isSelected
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-gray-200 text-gray-700'
                              }`}>
                                {option.label}
                              </span>
                              <span className="text-gray-800">
                                {hasMath(option.text) ? (
                                  <span dangerouslySetInnerHTML={{ __html: renderWithMath(option.text) }} />
                                ) : (
                                  option.text
                                )}
                              </span>
                              {flashcard.is_multiple && isSelected && (
                                <span className="ml-auto text-blue-500">✓</span>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  
                  {!showAnswer && (
                    <div className="flex flex-col items-center gap-4">
                      {flashcard.is_multiple_choice && selectedOptions.length > 0 && !answerVerified && (
                        <button
                          onClick={() => {
                            setAnswerVerified(true)
                            if (flashcard) {
                              saveAnswerVerified(flashcard.id, true)
                            }
                          }}
                          className="bg-gradient-to-r from-green-500 to-green-600 text-white px-8 py-3 rounded-lg font-medium text-lg hover:opacity-90 transition-opacity"
                        >
                          验证答案
                        </button>
                      )}

                      {(answerVerified || !flashcard.is_multiple_choice) && (
                        <button
                          onClick={handleShowAnswer}
                          className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-8 py-3 rounded-lg font-medium text-lg hover:opacity-90 transition-opacity"
                        >
                          {answerVerified ? '查看完整解析' : '显示答案'}
                        </button>
                      )}

                      {flashcard.is_multiple_choice && selectedOptions.length === 0 && !answerVerified && (
                        <p className="text-gray-500 text-sm">
                          {flashcard.is_multiple ? '请至少选择一个选项' : '请先选择一个选项'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 答案面 */}
            {isFlipped && (
              <div className="p-8 w-full flex flex-col text-center" style={{ transform: "rotateY(180deg)" }}>
                <div className="flex-1">
                  <span className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium mb-4">
                    答案
                  </span>

                  {flashcard.is_multiple_choice && (
                    <div className="text-xl text-gray-700 mb-4 leading-relaxed bg-gray-50 p-6 rounded-lg whitespace-pre-wrap">
                      {hasMath(flashcard.answer) ? (
                        <span dangerouslySetInnerHTML={{ __html: renderWithMath(flashcard.answer) }} />
                      ) : (
                        flashcard.answer
                      )}
                    </div>
                  )}

                  {!flashcard.is_multiple_choice && (
                    <div className="text-xl text-gray-700 mb-4 leading-relaxed bg-gray-50 p-6 rounded-lg">
                      {hasMath(flashcard.answer) ? (
                        <span dangerouslySetInnerHTML={{ __html: renderWithMath(flashcard.answer) }} />
                      ) : (
                        flashcard.answer
                      )}
                    </div>
                  )}

                  <p className="text-gray-500 py-4">你掌握得怎么样？</p>
                </div>

                <div className="flex-shrink-0 grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                  <button onClick={() => handleRating('again')} disabled={submitting} className="bg-red-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-600 disabled:opacity-50 transition-colors">
                    <div className="text-lg">😣</div>
                    <div>Again</div>
                    <div className="text-xs opacity-80">忘记</div>
                  </button>
                  <button onClick={() => handleRating('hard')} disabled={submitting} className="bg-orange-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors">
                    <div className="text-lg">😓</div>
                    <div>Hard</div>
                    <div className="text-xs opacity-80">困难</div>
                  </button>
                  <button onClick={() => handleRating('good')} disabled={submitting} className="bg-green-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-600 disabled:opacity-50 transition-colors">
                    <div className="text-lg">😊</div>
                    <div>Good</div>
                    <div className="text-xs opacity-80">一般</div>
                  </button>
                  <button onClick={() => handleRating('easy')} disabled={submitting} className="bg-blue-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors">
                    <div className="text-lg">😎</div>
                    <div>Easy</div>
                    <div className="text-xs opacity-80">简单</div>
                  </button>
                </div>

                <div className="mt-6">
                  <button onClick={() => { setIsFlipped(false); setShowAnswer(false) }} className="text-gray-600 hover:text-gray-800">
                    ← 返回问题
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>

        {/* 上一张/下一张导航 — 位置随卡片高度动态调整 */}
        {cards.length > 1 && (
          <div className="flex justify-center items-center gap-4 mb-8">
            <button
              onClick={handlePrevCard}
              disabled={currentIndex === 0}
              className="flex items-center gap-2 px-6 py-3 bg-white rounded-lg shadow hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
              上一张
            </button>
            <span className="text-gray-500 text-sm">
              {currentIndex + 1} / {cards.length}
            </span>
            <button
              onClick={handleNextCard}
              disabled={currentIndex === cards.length - 1}
              className="flex items-center gap-2 px-6 py-3 bg-white rounded-lg shadow hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              下一张
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* 复习历史 */}
        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">复习历史</h3>
          {reviewLogs.length === 0 ? (
            <p className="text-gray-500 text-center py-4">暂无复习记录</p>
          ) : (
            <div className="space-y-3">
              {reviewLogs.map(log => (
                <div key={log.id} className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center space-x-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      log.rating === 'again' ? 'bg-red-100 text-red-800' :
                      log.rating === 'hard' ? 'bg-orange-100 text-orange-800' :
                      log.rating === 'good' ? 'bg-green-100 text-green-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {log.rating === 'again' ? '😣' :
                       log.rating === 'hard' ? '😓' :
                       log.rating === 'good' ? '😊' : '😎'}
                    </div>
                    <div>
                      <div className="font-medium">{log.rating.toUpperCase()}</div>
                      <div className="text-sm text-gray-500">
                        {new Date(log.review_time).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {log.difficulty_before !== null && log.difficulty_after !== null && (
                      <div className="text-sm">
                        难度: {log.difficulty_before.toFixed(2)} → {log.difficulty_after.toFixed(2)}
                      </div>
                    )}
                    {log.scheduled_days !== null && (
                      <div className="text-sm text-gray-500">
                        间隔: {log.scheduled_days.toFixed(1)} 天
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-center space-x-4">
          <button
            onClick={handleBackToList}
            className="bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-medium hover:bg-gray-300 transition-colors"
          >
            返回列表
          </button>
          <button
            onClick={handleViewDocument}
            className="flex items-center gap-2 bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-medium hover:bg-gray-300 transition-colors"
          >
            <BookOpen className="w-5 h-5" />
            查看原文
          </button>
        </div>
      </div>

      <BottomNav />
      </motion.div>
    </PageTransition>
  )
}
