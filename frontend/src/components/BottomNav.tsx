import { Home, Settings, BookOpen, BarChart, Sparkles } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'

const BottomNav = () => {
  const location = useLocation()

  const navItems = [
    { icon: Home, label: '首页', path: '/', active: location.pathname === '/' },
    { icon: BookOpen, label: '文档', path: '/documents', active: location.pathname.startsWith('/documents') },
    { icon: BarChart, label: '统计', path: '/analytics', active: location.pathname.startsWith('/analytics') },
    { icon: Settings, label: '个人中心', path: '/settings', active: location.pathname === '/settings' },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <div className="bg-white/75 backdrop-blur-xl border-t border-stone-200/60 shadow-lg shadow-stone-200/20">
        <div className="flex items-center justify-around py-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.active
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative flex flex-col items-center justify-center p-2 rounded-2xl transition-all duration-300 ${
                  isActive
                    ? 'text-amber-600'
                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100/50'
                }`}
              >
                <div className="relative">
                  <Icon className="w-6 h-6" />
                  {isActive && (
                    <motion.div
                      className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                      layoutId="navDot"
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    />
                  )}
                </div>
                <span className="text-[10px] font-semibold mt-1 tracking-tight">{item.label}</span>
                {isActive && (
                  <motion.div
                    className="absolute -bottom-0.5 left-1/4 right-1/4 h-[2px] rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                    layoutId="navBar"
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  />
                )}
              </Link>
            )
          })}
        </div>
        <div className="h-safe-bottom" />
      </div>
    </div>
  )
}

export default BottomNav
