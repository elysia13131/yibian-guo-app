import { User, BookOpen, Target, TrendingUp } from 'lucide-react'
import { motion } from 'motion/react'
import { useAuth } from '../contexts/AuthContext'
import PageTransition from '../components/PageTransition'

const Profile = () => {
  const { user } = useAuth()

  const userStats = {
    totalStudyTime: 45,
    totalDocuments: 12,
    flashcardsCreated: 156,
    reviewPlans: 8,
    learningStreak: 21,
  }

  const recentActivities = [
    { id: 1, title: '上传文档', description: '上传了《机器学习导论》', time: '2小时前' },
    { id: 2, title: '生成抽认卡', description: '为《神经网络基础》创建了25张卡片', time: '昨天' },
    { id: 3, title: '复习完成', description: '完成了今天的复习计划', time: '1天前' },
    { id: 4, title: '知识检测', description: '检测到3个知识盲点', time: '2天前' },
  ]

  return (
    <PageTransition>
      <motion.div
        className="p-4 min-h-[calc(100vh-80px)]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
      <div className="max-w-4xl mx-auto">
        {/* 用户信息卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center space-x-4">
            <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <User className="w-12 h-12 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-800">{user?.username || '未登录'}</h1>
              <p className="text-gray-600 mb-2">学习时间 {userStats.totalStudyTime} 小时</p>
              <div className="flex items-center space-x-2">
                <div className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                  学习助手
                </div>
                <div className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                  连续学习 {userStats.learningStreak} 天
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 学习统计 */}
        <h2 className="text-xl font-bold text-gray-800 mb-4">学习统计</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">学习文档</p>
                <p className="text-2xl font-bold text-gray-800">{userStats.totalDocuments}</p>
              </div>
              <BookOpen className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">抽认卡</p>
                <p className="text-2xl font-bold text-gray-800">{userStats.flashcardsCreated}</p>
              </div>
              <Target className="w-8 h-8 text-green-500" />
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">复习计划</p>
                <p className="text-2xl font-bold text-gray-800">{userStats.reviewPlans}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-purple-500" />
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">学习时长</p>
                <p className="text-2xl font-bold text-gray-800">{userStats.totalStudyTime}h</p>
              </div>
              <User className="w-8 h-8 text-orange-500" />
            </div>
          </div>
        </div>

        {/* 最近活动 */}
        <h2 className="text-xl font-bold text-gray-800 mb-4">最近活动</h2>
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="space-y-4">
            {recentActivities.map((activity) => (
              <div key={activity.id} className="flex items-center justify-between py-3 border-b border-gray-200 last:border-b-0">
                <div>
                  <h3 className="font-semibold text-gray-800">{activity.title}</h3>
                  <p className="text-gray-600 text-sm">{activity.description}</p>
                </div>
                <span className="text-sm text-gray-500">{activity.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 学习建议 */}
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl shadow-lg p-6 mt-8">
          <h2 className="text-xl font-bold text-white mb-2">学习建议</h2>
          <p className="text-blue-100 mb-4">
            根据你的学习数据，建议今天复习相关章节内容
          </p>
          <button className="bg-white text-blue-600 font-semibold px-4 py-2 rounded-lg hover:bg-blue-50 transition">
            开始学习
          </button>
        </div>
      </div>
      </motion.div>
    </PageTransition>
  )
}

export default Profile
