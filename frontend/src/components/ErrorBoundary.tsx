import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center px-6">
          <p className="text-red-300/80 mb-2">阅读器渲染异常</p>
          <p className="text-gray-400 text-sm mb-6 max-w-md text-center">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => window.history.back()}
            className="px-6 py-2.5 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 hover:bg-indigo-500/30 transition-colors"
          >
            返回
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
