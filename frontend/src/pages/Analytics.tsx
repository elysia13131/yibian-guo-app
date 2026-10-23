import { BarChart3, TrendingUp, Calendar, Target, Award, Clock, PieChart, LineChart } from 'lucide-react'
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { analyticsApi } from '../api'
import type { AnalyticsResponse, WeeklyStats as WeeklyStatsType, Achievement as AchievementType } from '../types'
import PageTransition from '../components/PageTransition'

const Analytics = () => {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAnalytics()
  }, [])

  const fetchAnalytics = async () => {
    try {
      const data = await analyticsApi.getAnalytics()
      setAnalytics(data)
    } catch (error) {
      console.error('获取学习统计失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const subjectDistribution = [
    { subject: '机器学习', hours: 12, color: 'bg-blue-500' },
    { subject: '深度学习', hours: 8, color: 'bg-green-500' },
    { subject: '自然语言处理', hours: 6, color: 'bg-purple-500' },
    { subject: '计算机视觉', hours: 5, color: 'bg-orange-500' },
    { subject: '强化学习', hours: 3, color: 'bg-red-500' },
  ]

  const getAchievements = (): AchievementType[] => {
    if (!analytics) return []

    return [
      {
        title: '连续学习7天',
        icon: 'award',
        unlocked: analytics.overview.consecutive_study_days >= 7
      },
      {
        title: '学习时长1000分钟',
        icon: 'clock',
        unlocked: analytics.overview.total_study_minutes >= 1000
      },
      {
        title: '掌握100个概念',
        icon: 'target',
        unlocked: analytics.overview.total_chapters_read >= 100
      },
      {
        title: '月度学习之星',
        icon: 'trending-up',
        unlocked: analytics.overview.weekly_study_minutes >= 600
      },
    ]
  }

  const getProgressColor = (change: number) => {
    if (change > 0) return 'text-green-600 dark:text-green-400'
    if (change < 0) return 'text-red-600 dark:text-red-400'
    return 'text-orange-600 dark:text-orange-400'
  }

  const getProgressIcon = (change: number) => {
    if (change > 0) return '↑'
    if (change < 0) return '↓'
    return '→'
  }

  const getProgressText = (change: number) => {
    if (change > 0) return `${change}% 较上周`
    if (change < 0) return `${change}% 较上周`
    return '与上周持平'
  }

  const renderIcon = (iconName: string, className: string = 'w-5 h-5') => {
    switch (iconName) {
      case 'award':
        return <Award className={className} />
      case 'clock':
        return <Clock className={className} />
      case 'target':
        return <Target className={className} />
      case 'trending-up':
        return <TrendingUp className={className} />
      default:
        return <Award className={className} />
    }
  }

  return (
    <PageTransition>
      <motion.div
        className="p-4 min-h-[calc(100vh-80px)]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">学习统计</h1>
            <p className="text-gray-600 dark:text-gray-400">洞察你的学习进度和效果</p>
          </div>
          <div className="flex items-center space-x-2">
            <select className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100">
              <option>本周</option>
              <option>本月</option>
              <option>本季度</option>
              <option>今年</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4 animate-pulse">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="w-16 h-3 bg-gray-200 dark:bg-gray-700 rounded mb-1"></div>
                    <div className="w-12 h-6 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  </div>
                  <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
                </div>
                <div className="w-20 h-3 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">学习时长</p>
                  <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                    {analytics?.overview.total_study_minutes || 0}分钟
                  </p>
                </div>
                <Clock className="w-8 h-8 text-blue-500" />
              </div>
              <p className={`text-xs mt-2 ${getProgressColor(analytics?.overview.study_minutes_change || 0)}`}>
                {getProgressIcon(analytics?.overview.study_minutes_change || 0)} {getProgressText(analytics?.overview.study_minutes_change || 0)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">掌握概念</p>
                  <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                    {analytics?.overview.total_chapters_read || 0}
                  </p>
                </div>
                <Target className="w-8 h-8 text-green-500" />
              </div>
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                ↑ {analytics?.overview.study_efficiency || 0}% 效率
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">复习计划</p>
                  <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                    {analytics?.overview.consecutive_study_days || 0}
                  </p>
                </div>
                <Calendar className="w-8 h-8 text-purple-500" />
              </div>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                连续学习天数
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">学习效率</p>
                  <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                    {analytics?.overview.study_efficiency || 0}%
                  </p>
                </div>
                <TrendingUp className="w-8 h-8 text-orange-500" />
              </div>
              <p className={`text-xs mt-2 ${getProgressColor(analytics?.overview.efficiency_change || 0)}`}>
                {getProgressIcon(analytics?.overview.efficiency_change || 0)} {getProgressText(analytics?.overview.efficiency_change || 0)}
              </p>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">每周学习时长</h2>
            <BarChart3 className="w-6 h-6 text-gray-500 dark:text-gray-400" />
          </div>
          {loading ? (
            <div className="flex items-end justify-between h-40">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="flex flex-col items-center animate-pulse">
                  <div className="w-8 bg-gray-200 dark:bg-gray-700 rounded-t-lg" style={{ height: `${40 + Math.random() * 40}px` }}></div>
                  <div className="w-10 h-3 bg-gray-200 dark:bg-gray-700 rounded mt-2"></div>
                  <div className="w-6 h-2 bg-gray-200 dark:bg-gray-700 rounded mt-1"></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-end justify-between h-40">
              {(analytics?.weekly_data || []).map((data: WeeklyStatsType, index: number) => (
                <div key={index} className="flex flex-col items-center">
                  <div
                    className="w-8 bg-gradient-to-t from-blue-500 to-blue-300 rounded-t-lg"
                    style={{ height: `${Math.max(10, Math.min(160, data.minutes / 2))}px` }}
                  ></div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{data.day}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500">{data.minutes}分钟</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">学科分布</h2>
              <PieChart className="w-6 h-6 text-gray-500 dark:text-gray-400" />
            </div>
            <div className="space-y-4">
              {subjectDistribution.map((subject, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${subject.color}`}></div>
                    <span className="font-medium text-gray-800 dark:text-gray-100">{subject.subject}</span>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${subject.color}`}
                        style={{ width: `${(subject.hours / 30) * 100}%` }}
                      ></div>
                    </div>
                    <span className="font-semibold text-gray-800 dark:text-gray-100">{subject.hours}h</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">学习成就</h2>
              <Award className="w-6 h-6 text-gray-500 dark:text-gray-400" />
            </div>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700 animate-pulse">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-gray-600"></div>
                      <div>
                        <div className="w-24 h-4 bg-gray-200 dark:bg-gray-600 rounded mb-1"></div>
                        <div className="w-16 h-3 bg-gray-200 dark:bg-gray-600 rounded"></div>
                      </div>
                    </div>
                    <div className="w-16 h-6 bg-gray-200 dark:bg-gray-600 rounded-full"></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {getAchievements().map((achievement: AchievementType, index: number) => (
                  <div key={index} className={`flex items-center justify-between p-3 rounded-lg ${achievement.unlocked ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-gray-50 dark:bg-gray-700'}`}>
                    <div className="flex items-center space-x-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${achievement.unlocked ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-600 text-gray-400'}`}>
                        {renderIcon(achievement.icon)}
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-800 dark:text-gray-100">{achievement.title}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {achievement.unlocked ? '已解锁' : '待解锁'}
                        </p>
                      </div>
                    </div>
                    {achievement.unlocked ? (
                      <div className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-xs font-medium">
                        已获得
                      </div>
                    ) : (
                      <div className="px-3 py-1 bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400 rounded-full text-xs font-medium">
                        进行中
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">学习趋势</h2>
            <LineChart className="w-6 h-6 text-gray-500 dark:text-gray-400" />
          </div>
          <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl">
            <div className="text-center">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">学习效率{(analytics?.overview.efficiency_change || 0) >= 0 ? '提升' : '变化'}</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {(analytics?.overview?.consecutive_study_days ?? 0) > 0
                  ? `本周学习${analytics?.overview.weekly_study_minutes || 0}分钟，效率${(analytics?.overview.efficiency_change || 0) >= 0 ? '提升' : '下降'}${Math.abs(analytics?.overview.efficiency_change || 0)}%`
                  : '开始你的学习之旅吧！'}
              </p>
              <div className="flex justify-center space-x-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {Math.min(100, Math.max(0, (analytics?.overview.study_efficiency || 0) + Math.abs(analytics?.overview.efficiency_change || 0)))}%
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">记忆保持率</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {Math.min(100, Math.max(0, (analytics?.overview.study_efficiency || 0) + Math.floor(Math.abs(analytics?.overview.efficiency_change || 0) * 0.5)))}%
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">复习完成率</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                    {analytics?.overview.study_efficiency || 0}%
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">知识掌握率</p>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
      </motion.div>
    </PageTransition>
  )
}

export default Analytics
