// @ts-nocheck
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import { motion, useInView } from 'motion/react'
import * as THREE from 'three'
import { useRef, useEffect, useState, Suspense, useMemo, useCallback } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  BookOpen, Sparkles, Brain, Zap, FileText, BarChart3, FlaskConical, Users,
  ChevronRight, Clock, Rocket, Target, Lightbulb, Layers, Globe, Search,
  PenTool, Network, MessageCircle, Heart, GraduationCap, Award, Activity,
  Flame, Shield, Compass, Star, ChevronDown, Code, Database, Cpu,
  ChevronLeft, ChevronRight as ChevronRightIcon
} from 'lucide-react'
import { Link } from 'react-router-dom'

gsap.registerPlugin(ScrollTrigger)

// ====================================================================
// 全局鼠标视差 + 滚动速度追踪
// 效果七 + 效果八
// ====================================================================
const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 }
let scrollVelocity = 0

document.addEventListener('mousemove', (e) => {
  mouse.targetX = (e.clientX / window.innerWidth - 0.5) * 2
  mouse.targetY = (e.clientY / window.innerHeight - 0.5) * 2
})

// ====================================================================
// 效果十二：RGB 偏移 (Chromatic Aberration) 着色器
// ====================================================================
const rgbShiftVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const rgbShiftFragment = `
  uniform sampler2D uTexture;
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;

  void main() {
    float offset = 0.01 * uIntensity * (0.5 + 0.5 * sin(uTime * 0.5));
    float r = texture2D(uTexture, vUv + vec2(offset, 0.0)).r;
    float g = texture2D(uTexture, vUv).g;
    float b = texture2D(uTexture, vUv - vec2(offset, 0.0)).b;
    float a = texture2D(uTexture, vUv).a;
    gl_FragColor = vec4(r, g, b, a);
  }
`

// ====================================================================
// 效果十二：高级着色器粒子 —— 带呼吸、Fresnel边缘光、全息光泽
// ====================================================================
const particleVS = `
  uniform float uTime;
  uniform float uVelocity;
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aRandom;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vec3 pos = position;
    pos.y += sin(uTime * 0.5 + pos.x * 2.0 + pos.z * 2.0 + aRandom) * 0.2;
    pos.x += cos(uTime * 0.3 + pos.z * 1.5 + aRandom) * 0.12;
    pos.z += sin(uTime * 0.4 + pos.x * 1.8 + aRandom) * 0.08;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = length(mvPosition.xyz);
    // Fresnel-like 边缘发光（距离越远越亮）
    float fresnel = pow(1.0 - abs(pos.y / 15.0), 2.0);
    vAlpha = 0.3 + fresnel * 0.7;

    gl_PointSize = aSize * (350.0 / -mvPosition.z) * (1.0 + uVelocity * 2.5);
    gl_PointSize = clamp(gl_PointSize, 1.5, 35.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`
const particleFS = `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uHologram;  // 全息光泽
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    if (d > 0.5) discard;
    float glow = 1.0 - smoothstep(0.0, 0.5, d);
    float core = 1.0 - smoothstep(0.0, 0.2, d);
    vec3 color = mix(vColor, vec3(1.0), core * 0.5);

    // 全息扫光（效果九）
    float diagonal = gl_PointCoord.x * 0.8 + gl_PointCoord.y;
    float sheen = pow(1.0 - smoothstep(0.0, 0.5, abs(diagonal - 0.5 - 0.5 * sin(uTime * 0.6))), 3.0);
    color += vec3(0.85, 0.92, 1.0) * sheen * uHologram * 0.6;

    float alpha = glow * uOpacity * vAlpha * (0.7 + 0.3 * sin(uTime * 0.4 + d * 8.0));
    gl_FragColor = vec4(color, alpha);
  }
`

// ====================================================================
// 效果十二：扫描线 + 网格背景着色器
// ====================================================================
const gridVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const gridFragmentShader = `
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv * 4.0;
    // 网格
    vec2 grid = abs(fract(uv) - 0.5);
    float line = min(grid.x, grid.y);
    float gridLine = 1.0 - smoothstep(0.0, 0.03, line);

    // 扫描线
    float scanline = sin(uv.y * 200.0 + uTime * 2.0) * 0.5 + 0.5;
    scanline = 0.92 + scanline * 0.08;

    // 呼吸脉冲
    float pulse = 0.5 + 0.5 * sin(uTime * 0.3);

    vec3 color1 = vec3(0.05, 0.05, 0.1);
    vec3 color2 = vec3(0.15, 0.08, 0.02);
    vec3 bg = mix(color1, color2, pulse * 0.3);

    vec3 gridColor = vec3(0.25, 0.15, 0.05) * (0.1 + gridLine * 0.3);
    vec3 final = mix(bg, gridColor, gridLine * 0.5) * scanline;

    gl_FragColor = vec4(final, 0.3);
  }
`

// ====================================================================
// 3D 场景组件
// ====================================================================

// 高级粒子场（带全息光泽 + Fresnel）
function AdvancedParticleField() {
  const pointsRef = useRef(null)
  const materialRef = useRef(null)
  const count = 2000

  const { positions, colors, sizes, randoms } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const rnd = new Float32Array(count)
    const palette = [
      new THREE.Color('#f59e0b'), new THREE.Color('#d97706'),
      new THREE.Color('#8b5cf6'), new THREE.Color('#06b6d4'),
      new THREE.Color('#f97316'), new THREE.Color('#10b981'),
    ]
    for (let i = 0; i < count; i++) {
      const radius = 5 + Math.random() * 18
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      pos[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = (Math.random() - 0.5) * 20
      pos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
      const c = palette[Math.floor(Math.random() * palette.length)]
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
      size[i] = 0.2 + Math.random() * 0.8
      rnd[i] = Math.random() * Math.PI * 2
    }
    return { positions: pos, colors: col, sizes: size, randoms: rnd }
  }, [])

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
      const decay = 0.92, inertia = 0.15
      scrollVelocity = scrollVelocity * decay + Math.abs(mouse.targetY * 0.5) * inertia
      materialRef.current.uniforms.uVelocity.value = Math.min(scrollVelocity, 1.0)
      materialRef.current.uniforms.uOpacity.value = 0.25 + scrollVelocity * 0.75
      materialRef.current.uniforms.uHologram.value = Math.min(scrollVelocity * 1.5, 1.0)
    }
    if (pointsRef.current) {
      mouse.x += (mouse.targetX - mouse.x) * 0.03
      mouse.y += (mouse.targetY - mouse.y) * 0.03
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.015 + mouse.x * 0.12
      pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.03) * 0.08 + mouse.y * 0.06
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aColor" count={count} array={colors} itemSize={3} />
        <bufferAttribute attach="attributes-aSize" count={count} array={sizes} itemSize={1} />
        <bufferAttribute attach="attributes-aRandom" count={count} array={randoms} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={particleVS}
        fragmentShader={particleFS}
        transparent depthWrite={false} blending={THREE.AdditiveBlending}
        uniforms={{ uTime: { value: 0 }, uVelocity: { value: 0 }, uOpacity: { value: 0.5 }, uHologram: { value: 0 } }}
      />
    </points>
  )
}

// 螺旋元素阵列（效果一：增强版）
function SpiralElements() {
  const groupRef = useRef(null)
  const count = 36
  const meshesRef = useRef([])

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.12
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.06) * 0.08
    }
    // 单独脉冲动画
    meshesRef.current.forEach((mesh, i) => {
      if (mesh) {
        const t = i / count
        mesh.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 1.5 + t * Math.PI * 2) * 0.2)
      }
    })
  })

  return (
    <group ref={groupRef}>
      {Array.from({ length: count }).map((_, i) => {
        const t = i / count
        const angle = t * Math.PI * 6
        const radius = 2.8 + Math.sin(t * Math.PI * 2) * 1.8
        const x = Math.cos(angle) * radius
        const y = t * 10 - 5
        const z = Math.sin(angle) * radius
        const hue = 0.06 + t * 0.15
        return (
          <Float key={i} speed={0.8 + t * 0.5} rotationIntensity={0.15} floatIntensity={0.25}>
            <mesh
              ref={(el) => { meshesRef.current[i] = el }}
              position={[x, y, z]}
              rotation={[0, angle, Math.sin(angle) * 0.2]}
            >
              <boxGeometry args={[0.35, 0.7, 0.03]} />
              <meshStandardMaterial
                color={new THREE.Color().setHSL(hue, 0.9, 0.45 + t * 0.25)}
                emissive={new THREE.Color().setHSL(hue, 0.9, 0.25)}
                emissiveIntensity={0.5}
                metalness={0.4} roughness={0.3}
              />
            </mesh>
          </Float>
        )
      })}
    </group>
  )
}

// 效果九：3D 浮动网格装饰（漂浮的科技感几何体）
function FloatingTechGrid() {
  const groupRef = useRef(null)
  const count = 8

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.08
    }
  })

  return (
    <group ref={groupRef}>
      {Array.from({ length: count }).map((_, i) => {
        const t = i / count
        const angle = t * Math.PI * 2
        const radius = 5.5
        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius
        const y = Math.sin(t * Math.PI * 4) * 2
        const type = i % 3
        return (
          <Float key={i} speed={0.6 + t} rotationIntensity={0.3} floatIntensity={0.4}>
            <mesh position={[x, y, z]} rotation={[t * Math.PI, t * Math.PI * 0.5, 0]}>
              {type === 0 && <icosahedronGeometry args={[0.3, 0]} />}
              {type === 1 && <octahedronGeometry args={[0.35, 0]} />}
              {type === 2 && <torusGeometry args={[0.25, 0.08, 8, 16]} />}
              <meshStandardMaterial
                color={new THREE.Color().setHSL(0.08 + t * 0.15, 0.8, 0.5)}
                wireframe
                transparent
                opacity={0.3}
                emissive={new THREE.Color().setHSL(0.08 + t * 0.15, 0.8, 0.2)}
                emissiveIntensity={0.3}
              />
            </mesh>
          </Float>
        )
      })}
    </group>
  )
}

// 效果十一：聚光灯环（增强版）
function SpotlightRing() {
  const ref = useRef(null)

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.z = state.clock.elapsedTime * 0.15
      const scale = 1 + Math.sin(state.clock.elapsedTime * 0.25) * 0.2
      ref.current.scale.set(scale, scale, 1)
    }
  })

  return (
    <mesh ref={ref} position={[0, -7, -6]} rotation={[-Math.PI / 2.5, 0, 0]}>
      <ringGeometry args={[0.3, 4.5, 64]} />
      <meshBasicMaterial color="#f59e0b" transparent opacity={0.06} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
    </mesh>
  )
}

// 扫描线+网格背景平面
function ScanlineBackground() {
  const ref = useRef(null)
  return (
    <mesh ref={ref} position={[0, 0, -12]} scale={[30, 20, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={gridVertexShader}
        fragmentShader={gridFragmentShader}
        transparent depthWrite={false}
        uniforms={{
          uTime: { value: 0 },
          uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        }}
        onBeforeCompile={(shader) => {
          const timeUniform = shader.uniforms.uTime
          if (timeUniform) {
            useFrame((state) => { timeUniform.value = state.clock.elapsedTime })
          }
        }}
      />
    </mesh>
  )
}

// 场景滚动控制器
function SceneController({ scrollProgress }) {
  const { camera } = useThree()
  const camPos = useRef({ x: 0, y: 0, z: 15 })

  useFrame(() => {
    const targetZ = 15 - scrollProgress * 7
    const targetY = scrollProgress * 2.5
    camPos.current.z += (targetZ - camPos.current.z) * 0.02
    camPos.current.y += (targetY - camPos.current.y) * 0.02
    const px = mouse.x * 1.8
    const py = mouse.y * 1.2
    camera.position.x += (px - camera.position.x) * 0.02
    camera.position.y += (py + camPos.current.y - camera.position.y) * 0.02
    camera.position.z += (camPos.current.z - camera.position.z) * 0.02
    camera.lookAt(0, 0, 0)
  })
  return null
}

function SceneBackground() {
  const { scene } = useThree()
  useEffect(() => {
    // 使用纯色背景替代远程HDR加载（避免海外CDN超时问题）
    scene.background = new THREE.Color(0x0a0a0a)
    // 添加微弱雾效加强景深感
    scene.fog = new THREE.FogExp2(0x0a0a0a, 0.015)
    return () => {
      scene.background = null
      scene.fog = null
    }
  }, [scene])
  return null
}

function Scene3D({ scrollProgress }) {
  return (
    <>
      <SceneBackground />
      <ambientLight intensity={0.35} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} color="#fff7ed" />
      <pointLight position={[-10, -5, -5]} intensity={0.6} color="#8b5cf6" />
      <pointLight position={[5, 5, 5]} intensity={0.3} color="#06b6d4" />
      <AdvancedParticleField />
      <SpiralElements />
      <FloatingTechGrid />
      <SpotlightRing />
      <SceneController scrollProgress={scrollProgress} />
    </>
  )
}

// ====================================================================
// 效果二：溶解式文字揭示
// ====================================================================
function DissolveTitle({ children, className = '' }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-80px" })
  return (
    <div ref={ref} className={className}>
      <motion.div
        initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
        animate={isInView ? { opacity: 1, clipPath: 'inset(0 0% 0 0)' } : {}}
        transition={{ duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
      >
        {children}
      </motion.div>
    </div>
  )
}

// 效果十二：RGB偏移文字 - 仅对特定文字应用效果
function RGBText({ children, className = '' }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })
  return (
    <motion.div
      ref={ref}
      className={`relative ${className}`}
      initial={{ opacity: 0 }}
      animate={isInView ? { opacity: 1 } : {}}
    >
      {children}
    </motion.div>
  )
}

// RGB 偏移效果组件 - 用 text-shadow 实现，避免 bg-clip-text 继承问题
function RGBShiftText({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })
  const [shadow, setShadow] = useState('none')

  useEffect(() => {
    if (!isInView) return
    let frame: number
    const animate = () => {
      const t = Date.now() * 0.001
      const ox = Math.sin(t * 0.8) * 2.5
      const oy = Math.cos(t * 0.6) * 0.5
      setShadow(
        `${ox}px ${oy}px 0 rgba(0, 255, 255, 0.5), ${-ox}px ${-oy}px 0 rgba(255, 0, 102, 0.5)`
      )
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [isInView])

  return (
    <motion.span
      ref={ref}
      className={`relative inline-block ${className}`}
      initial={{ opacity: 0 }}
      animate={isInView ? { opacity: 1 } : {}}
      style={{ textShadow: shadow }}
    >
      {text}
    </motion.span>
  )
}

// 效果九：全息光泽卡片
function FeatureCard({ icon, title, description, tags = [], delay = 0 }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })
  const cardRef = useRef(null)

  // 鼠标跟随倾斜（效果九）
  const handleMouseMove = (e) => {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    card.style.setProperty('--rx', `${-y * 12}deg`)
    card.style.setProperty('--ry', `${x * 12}deg`)
  }
  const handleMouseLeave = () => {
    const card = cardRef.current
    if (!card) return
    card.style.setProperty('--rx', '0deg')
    card.style.setProperty('--ry', '0deg')
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40, scale: 0.92, filter: 'blur(8px)' }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' } : {}}
      transition={{ duration: 0.7, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className="group perspective-[800px]"
    >
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative transition-transform duration-200 ease-out"
        style={{ transform: 'rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))', transformStyle: 'preserve-3d' }}
      >
        {/* 全息光泽层（效果九） */}
        <div className="absolute inset-0 rounded-3xl overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
          <div
            className="absolute inset-0 bg-gradient-to-br from-transparent via-amber-400/10 to-transparent"
            style={{ transform: 'translateX(var(--shine-x, -100%))' }}
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="relative bg-white/80 backdrop-blur-xl rounded-3xl p-8 border border-amber-200/50 shadow-xl shadow-amber-500/5 hover:shadow-2xl hover:shadow-amber-500/10 transition-all duration-300" style={{ transform: 'translateZ(20px)' }}>
          <motion.div
            className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-5 shadow-lg shadow-amber-500/30"
            whileHover={{ scale: 1.15, rotate: 5 }}
            transition={{ type: 'spring', stiffness: 300 }}
            style={{ transform: 'translateZ(30px)' }}
          >
            <div className="text-white">{icon}</div>
          </motion.div>
          <h3 className="text-xl font-bold text-stone-800 mb-3 group-hover:text-amber-600 transition-colors" style={{ transform: 'translateZ(15px)' }}>{title}</h3>
          <p className="text-stone-600 leading-relaxed mb-3">{description}</p>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2" style={{ transform: 'translateZ(10px)' }}>
              {tags.map((tag, i) => (
                <span key={i} className="px-2.5 py-1 text-xs rounded-full bg-amber-100 text-amber-700 font-medium">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// 效果八：滚动速度辉光反馈
function VelocityGlow() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: document.body, start: 'top top', end: 'bottom bottom',
        onUpdate: (self) => {
          const vel = Math.abs(self.getVelocity() / 1000)
          const clamped = Math.min(vel, 0.5)
          gsap.to(el, { opacity: 0.1 + clamped * 0.9, scale: 1 + clamped * 0.12, duration: 0.2, ease: 'power2.out' })
        },
      })
    }, el)
    return () => ctx.revert()
  }, [])

  return (
    <div ref={ref} className="fixed inset-0 pointer-events-none z-[4]"
      style={{ background: 'radial-gradient(circle at 50% 50%, rgba(245,158,11,0.06) 0%, transparent 70%)', opacity: 0.1 }}
    />
  )
}

// 计数器
function StatCounter({ value, label, suffix = '' }) {
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })
  useEffect(() => {
    if (isInView) {
      const duration = 2000, steps = 60
      const increment = value / steps
      let current = 0
      const timer = setInterval(() => {
        current += increment
        if (current >= value) { setCount(value); clearInterval(timer) }
        else setCount(Math.floor(current))
      }, duration / steps)
      return () => clearInterval(timer)
    }
  }, [isInView, value])
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 20 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5 }} className="text-center">
      <div className="text-5xl md:text-6xl font-black bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">{count}{suffix}</div>
      <div className="text-stone-400 font-medium mt-2">{label}</div>
    </motion.div>
  )
}

// 步骤项
function StepItem({ icon, title, description, color, index, sub = [] }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-80px" })
  return (
    <motion.div ref={ref} initial={{ opacity: 0, x: index % 2 === 0 ? -60 : 60, filter: 'blur(6px)' }} animate={isInView ? { opacity: 1, x: 0, filter: 'blur(0px)' } : {}} transition={{ duration: 0.6, delay: index * 0.1, ease: [0.25, 0.1, 0.25, 1] }}>
      <div className="flex items-start gap-6 group">
        <motion.div className={`flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-lg`} whileHover={{ scale: 1.1, rotate: -5 }} transition={{ type: 'spring', stiffness: 300 }}>
          {icon}
        </motion.div>
        <div className="flex-1 bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 hover:border-amber-500/30 transition-colors">
          <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
          <p className="text-stone-400 mb-3">{description}</p>
          {sub.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {sub.map((s, j) => (
                <div key={j} className="flex items-center gap-2 text-sm text-stone-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// FAQ 折叠项
function FAQItem({ question, answer, index }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 20 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ delay: index * 0.08 }}
      className="border border-white/10 rounded-2xl overflow-hidden hover:border-amber-500/30 transition-colors"
    >
      <button onClick={() => setOpen(!open)} className="w-full px-6 py-5 flex items-center justify-between text-left">
        <span className="text-white font-semibold">{question}</span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3 }}>
          <ChevronDown className="w-5 h-5 text-stone-400" />
        </motion.div>
      </button>
      <motion.div initial={false} animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
        <div className="px-6 pb-5 text-stone-400 leading-relaxed">{answer}</div>
      </motion.div>
    </motion.div>
  )
}

// Agent 卡片
function AgentCard({ icon, name, desc, color, index }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30, scale: 0.9 }} animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}} transition={{ delay: index * 0.06, duration: 0.4 }}
      whileHover={{ y: -5, scale: 1.03 }} className="group"
    >
      <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10 hover:border-amber-500/30 transition-all text-center h-full">
        <div className={`w-12 h-12 mx-auto rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-3 text-white group-hover:scale-110 transition-transform`}>
          {icon}
        </div>
        <h4 className="font-bold text-white text-sm mb-1">{name}</h4>
        <p className="text-xs text-stone-500">{desc}</p>
      </div>
    </motion.div>
  )
}

// ====================================================================
// 主页
// ====================================================================
export default function LandingPage() {
  const containerRef = useRef(null)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [activeFaq, setActiveFaq] = useState(null)
  const cinematicEase = [0.45, 0.05, 0.55, 0.95]

  // 滚动进度
  useEffect(() => {
    const updateScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      setScrollProgress(Math.min(window.scrollY / docHeight, 1))
    }
    window.addEventListener('scroll', updateScroll, { passive: true })
    return () => window.removeEventListener('scroll', updateScroll)
  }, [])

  // GSAP
  useEffect(() => {
    const ctx = gsap.context(() => {
      const heroTl = gsap.timeline({ defaults: { ease: 'power4.out' } })
      heroTl
        .from('.hero-badge', { y: -30, opacity: 0, duration: 0.8, delay: 0.2 })
        .from('.hero-title-line', { y: 80, opacity: 0, duration: 1, stagger: 0.2 }, '-=0.4')
        .from('.hero-subtitle', { y: 40, opacity: 0, duration: 0.8 }, '-=0.6')
        .from('.hero-cta > *', { y: 30, opacity: 0, duration: 0.6, stagger: 0.15 }, '-=0.4')

      ScrollTrigger.batch('.feature-card', {
        onEnter: (elements) => gsap.fromTo(elements, { y: 60, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.6, stagger: 0.1, ease: 'power3.out' }),
        once: true, start: 'top 85%',
      })
      ScrollTrigger.batch('.step-item', {
        onEnter: (elements) => gsap.fromTo(elements, { x: (i) => i % 2 === 0 ? -40 : 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, stagger: 0.15, ease: 'power3.out' }),
        once: true, start: 'top 85%',
      })
    }, containerRef)
    return () => ctx.revert()
  }, [])

  // ===== 数据 =====
  const features = [
    { icon: <BookOpen className="w-8 h-8" />, title: '智能文档管理', description: '支持 PDF、Word、Markdown 等多种格式上传，AI 自动提取关键知识点，智能分类归档，构建你的个人知识库。', tags: ['多格式支持', 'AI分类', '全文检索'] },
    { icon: <Brain className="w-8 h-8" />, title: 'FSRS 间隔重复', description: '基于最先进的 FSRS 算法，精准计算每个知识点的最佳复习时间，科学安排复习计划，记忆效率提升 300%。', tags: ['FSRS算法', '自适应', '遗忘曲线'] },
    { icon: <Sparkles className="w-8 h-8" />, title: 'AI 智能助手', description: '灵枢（Harness）多Agent专家组，覆盖知识讲解、题目生成、临床思维、学情分析等9大专业角色。', tags: ['9大Agent', 'RAG', '多轮对话'] },
    { icon: <Network className="w-8 h-8" />, title: '思维导图生成', description: 'AI 自动将文档内容转化为可视化思维导图，知识结构一目了然，支持交互式编辑与导出。', tags: ['自动生成', 'Markmap', '交互编辑'] },
    { icon: <PenTool className="w-8 h-8" />, title: '智能抽认卡', description: '自动从文档提取关键概念生成抽认卡，支持自定义卡片内容和复习频率，学习更高效。', tags: ['自动生成', '自定义', 'FSRS'] },
    { icon: <MessageCircle className="w-8 h-8" />, title: 'RAG 智能问答', description: '基于向量检索和 DeepSeek AI，针对你的文档进行精准问答，快速找到你需要的答案。', tags: ['向量搜索', '精准检索', '上下文感知'] },
    { icon: <FlaskConical className="w-8 h-8" />, title: '视觉学习体验', description: 'Narraleaf 沉浸式3D学习场景，带有角色扮演和剧情交互，让学习变得像游戏一样有趣。', tags: ['3D场景', 'MMD角色', '剧情交互'] },
    { icon: <BarChart3 className="w-8 h-8" />, title: '数据分析看板', description: '详细的学习数据统计，包括时长、效率、连续学习天数等，用数据驱动学习优化。', tags: ['学习统计', '进度追踪', '数据洞察'] },
    { icon: <Target className="w-8 h-8" />, title: '知识盲点检测', description: 'AI 智能分析你的学习行为，识别薄弱环节和知识盲区，针对性推荐复习内容。', tags: ['薄弱分析', '智能推荐', '精准补强'] },
    { icon: <GraduationCap className="w-8 h-8" />, title: '多Agent专家组', description: '知识管家、教学导师、题库专家、临床教练、复习规划师等9大AI角色协同工作，全方位辅助学习。', tags: ['协作架构', '待办清单', '角色分工'] },
    { icon: <Flame className="w-8 h-8" />, title: '实验报告助手', description: 'AI 辅助完成实验报告，自动采集数据、渲染图表、格式化排版，支持一键导出。', tags: ['数据采集', '图表渲染', '一键导出'] },
    { icon: <Heart className="w-8 h-8" />, title: '情绪陪伴', description: '专属陪伴Agent感知你的学习情绪，适时鼓励、调节氛围，让学习不再孤单。', tags: ['情绪感知', '鼓励', '氛围调节'] },
  ]

  const stats = [
    { value: 10000, label: '累计学习分钟', suffix: '+' },
    { value: 500, label: '活跃用户', suffix: '+' },
    { value: 98, label: '用户满意度', suffix: '%' },
    { value: 9, label: '智能Agent', suffix: '' },
  ]

  const steps = [
    { icon: <FileText className="w-8 h-8" />, title: '上传文档', description: '将你的学习资料一键上传，系统自动识别格式并进行OCR预处理', color: 'from-amber-400 to-orange-500', sub: ['PDF/Word/Markdown', '自动OCR识别'] },
    { icon: <Cpu className="w-8 h-8" />, title: 'AI 深度分析', description: 'DeepSeek AI 自动分析文档内容，提取核心知识点、构建知识图谱', color: 'from-violet-400 to-purple-500', sub: ['知识图谱构建', '关键概念提取'] },
    { icon: <GraduationCap className="w-8 h-8" />, title: '生成学习材料', description: '自动生成思维导图、抽认卡、练习题，多维度巩固学习效果', color: 'from-cyan-400 to-blue-500', sub: ['思维导图', '抽认卡', '练习题'] },
    { icon: <Brain className="w-8 h-8" />, title: '科学复习', description: 'FSRS 算法精确安排复习时间，每次复习都在最佳记忆节点', color: 'from-indigo-400 to-purple-500', sub: ['FSRS算法', '个性化排期'] },
    { icon: <Search className="w-8 h-8" />, title: 'AI 问答与诊断', description: 'RAG 精准问答 + 知识盲点检测，随时检验理解深度', color: 'from-rose-400 to-pink-500', sub: ['RAG问答', '盲点检测'] },
    { icon: <BarChart3 className="w-8 h-8" />, title: '数据分析与优化', description: '全方位学习数据可视化，持续优化学习策略', color: 'from-emerald-400 to-teal-500', sub: ['数据分析', '策略优化'] },
  ]

  const agents = [
    { icon: <BookOpen size={16} />, name: '知识管家', desc: '名词解释·解剖定位', color: 'from-amber-400 to-orange-500' },
    { icon: <GraduationCap size={16} />, name: '教学导师', desc: '多风格讲解·费曼考官', color: 'from-violet-400 to-purple-500' },
    { icon: <PenTool size={16} />, name: '题库专家', desc: '多题型出题·错题复盘', color: 'from-cyan-400 to-blue-500' },
    { icon: <Activity size={16} />, name: '临床教练', desc: '病例分析·鉴别诊断', color: 'from-emerald-400 to-teal-500' },
    { icon: <Clock size={16} />, name: '复习规划师', desc: '记忆曲线·考点预测', color: 'from-rose-400 to-pink-500' },
    { icon: <FlaskConical size={16} />, name: '实验助手', desc: '实验报告·图表渲染', color: 'from-amber-400 to-orange-500' },
    { icon: <BarChart3 size={16} />, name: '学情分析师', desc: '薄弱预测·模拟面试', color: 'from-violet-400 to-purple-500' },
    { icon: <Heart size={16} />, name: '陪伴使者', desc: '情绪感知·鼓励', color: 'from-rose-400 to-pink-500' },
    { icon: <Compass size={16} />, name: '方法论教练', desc: '论文审稿·科研方法', color: 'from-cyan-400 to-blue-500' },
  ]

  const faqs = [
    { question: '一遍过适合哪些人群使用？', answer: '适合所有需要高效学习的人群，包括医学生、考研党、自学者、职场考证人士等。特别适合需要处理大量文档资料并进行系统复习的学习场景。' },
    { question: '一遍过与传统学习平台有什么区别？', answer: '一遍过深度融合 AI 技术，提供从文档上传到知识掌握的全流程智能化服务。多Agent专家组、FSRS 科学复习算法、RAG 智能问答等核心功能，让学习效率全面提升。' },
    { question: 'FSRS 间隔重复算法有什么优势？', answer: 'FSRS（Free Spaced Repetition Scheduler）是目前最先进的间隔重复算法，相比传统SM-2算法，它能更精确地预测你的记忆状态，在"恰到好处的难度"时刻安排复习，效率提升 300%。' },
    { question: '多Agent专家组系统如何工作？', answer: '主Agent（协调器）接收你的请求后，会生成待办清单并动态组建子Agent专家组。9个专业Agent各司其职，通过消息总线协作，全部任务完成后由主Agent汇总结果。子Agent的上下文随任务结束而清空，保证信息安全。' },
    { question: 'Narraleaf 3D 学习场景是什么？', answer: 'Narraleaf 是一款基于 Three.js 的沉浸式视觉小说引擎。你可以创建自己的 3D 角色，在丰富的场景中与角色互动，让学习内容以故事形式呈现，极大地提升学习趣味性和代入感。' },
    { question: '一遍会不会丢失我的数据？', answer: '所有数据都安全存储在云端数据库中，支持自动备份。你可以随时导出学习资料和进度数据。此外，采用 JWT 认证和加密传输，确保你的信息安全。' },
  ]

  // ===== Render =====
  return (
    <div ref={containerRef} className="relative bg-gradient-to-b from-stone-900 via-stone-800 to-stone-900 overflow-x-hidden">
      <VelocityGlow />

      {/* 3D 背景 */}
      <div className="fixed inset-0 z-0">
        <Canvas camera={{ position: [0, 0, 15], fov: 55 }} gl={{ antialias: true, alpha: true }}>
          <Scene3D scrollProgress={scrollProgress} />
        </Canvas>
      </div>

      {/* 内容 */}
      <div className="relative z-10">

        {/* ==================== HERO ==================== */}
        <section className="min-h-screen flex items-center justify-center px-4 pt-20 relative">
          <div className="max-w-5xl mx-auto text-center">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, delay: 0.2 }}
              className="hero-badge inline-flex items-center gap-2 px-5 py-2 rounded-full bg-amber-500/20 backdrop-blur-sm border border-amber-500/30 text-amber-400 text-sm font-medium mb-8"
            >
              <Sparkles size={16} /> 智能学习新时代
            </motion.div>

            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black leading-tight mb-6">
              <span className="hero-title-line inline-block bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 bg-clip-text text-transparent">
                <RGBShiftText text="一遍过" />
              </span>
              <br />
              <span className="hero-title-line inline-block text-3xl md:text-5xl lg:text-6xl text-stone-300 font-bold">
                智能学习平台
              </span>
            </h1>

            <p className="hero-subtitle text-lg md:text-xl text-stone-400 max-w-3xl mx-auto mb-10 leading-relaxed">
              融合文档管理、AI知识提取、FSRS科学复习、多Agent专家组、3D沉浸场景于一体，
              <br className="hidden md:block" />
              让学习更高效、更智能、更有趣。
            </p>

            <div className="hero-cta flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/auth" className="group relative px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-2xl shadow-2xl shadow-amber-500/30 hover:shadow-amber-500/50 transition-all duration-300 hover:scale-105">
                <span className="relative z-10 flex items-center gap-2">开始学习 <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></span>
              </Link>
              <a href="#features" className="px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-2xl border border-white/20 hover:bg-white/20 transition-all duration-300">了解更多</a>
            </div>

            {/* 特色标签云 */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 }}
              className="flex flex-wrap justify-center gap-3 mt-12 max-w-xl mx-auto"
            >
              {['AI 驱动', 'FSRS算法', '多Agent', '3D场景', 'RAG问答', '思维导图'].map((tag) => (
                <span key={tag} className="px-3 py-1.5 text-xs rounded-full bg-white/5 border border-white/10 text-stone-400 hover:border-amber-500/40 hover:text-amber-400 transition-all">{tag}</span>
              ))}
            </motion.div>

            <motion.div className="absolute bottom-10 left-1/2 -translate-x-1/2" animate={{ y: [0, 10, 0] }} transition={{ duration: 2, repeat: Infinity }}>
              <div className="w-6 h-10 rounded-full border-2 border-white/30 flex items-start justify-center p-2">
                <motion.div className="w-1.5 h-1.5 rounded-full bg-white/60" animate={{ y: [0, 12, 0] }} transition={{ duration: 2, repeat: Infinity }} />
              </div>
              <p className="text-white/30 text-xs mt-3 tracking-widest">SCROLL</p>
            </motion.div>
          </div>
        </section>

        {/* ==================== 品牌故事 ==================== */}
        <section className="py-24 px-4">
          <div className="max-w-5xl mx-auto">
            <DissolveTitle className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-black text-white mb-6">
                什么是一遍<span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">过</span>？
              </h2>
            </DissolveTitle>
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}
              className="bg-white/5 backdrop-blur-sm rounded-3xl p-8 md:p-12 border border-white/10"
            >
              <div className="grid md:grid-cols-2 gap-8 items-center">
                <div>
                  <p className="text-stone-300 text-lg leading-relaxed mb-6">
                    <strong className="text-amber-400">一遍过</strong> 是一个面向个人的智能学习平台。我们相信，学习的本质不是重复的次数，而是<strong className="text-amber-400">每一次的深度</strong>。
                  </p>
                  <p className="text-stone-400 leading-relaxed mb-6">
                    通过整合 AI 文档分析、FSRS 科学复习算法、多Agent专家组协作、以及 3D 沉浸式学习场景，一遍过重新定义了"高效学习"的标准——让每一遍学习都真正"过"出效果。
                  </p>
                  <div className="flex items-center gap-4 flex-wrap">
                    {['🏆 AI驱动', '🧠 科学记忆', '🎮 游戏化', '🤖 多Agent'].map((item) => (
                      <span key={item} className="text-stone-500 text-sm">{item}</span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { icon: <Rocket size={24} />, label: '10x效率' },
                    { icon: <Brain size={24} />, label: '精准记忆' },
                    { icon: <Users size={24} />, label: '社区共享' },
                    { icon: <Award size={24} />, label: '持续进步' },
                  ].map((item) => (
                    <motion.div key={item.label} whileHover={{ scale: 1.05 }} className="bg-white/5 rounded-2xl p-5 text-center border border-white/10 hover:border-amber-500/40 transition-all">
                      <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center text-amber-400 mb-2">{item.icon}</div>
                      <p className="text-white font-bold">{item.label}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ==================== 数据统计 ==================== */}
        <section className="py-20 px-4">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (<StatCounter key={i} {...stat} />))}
          </div>
        </section>

        {/* ==================== 全功能特性 ==================== */}
        <section id="features" className="min-h-screen py-24 px-4">
          <div className="max-w-6xl mx-auto">
            <DissolveTitle className="text-center mb-6">
              <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
                12 大核心<span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">功能</span>
              </h2>
              <p className="text-stone-400 text-lg max-w-2xl mx-auto">覆盖从知识输入到长期记忆的全链路学习需求</p>
            </DissolveTitle>

            {/* 功能分类导航 */}
            <div className="flex flex-wrap justify-center gap-3 mb-12">
              {['📚 学习管理', '🧠 记忆增强', '🤖 AI智能', '📊 数据分析', '🎮 沉浸体验'].map((cat) => (
                <span key={cat} className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-stone-400 hover:border-amber-500/40 hover:text-amber-400 transition-all cursor-default">{cat}</span>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature, i) => (
                <div key={i} className="feature-card">
                  <FeatureCard {...feature} delay={i * 0.06} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ==================== 多Agent专家组 ==================== */}
        <section className="py-24 px-4">
          <div className="max-w-6xl mx-auto">
            <DissolveTitle className="text-center mb-6">
              <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
                9 大 AI <span className="bg-gradient-to-r from-violet-400 to-cyan-500 bg-clip-text text-transparent">专家团</span>
              </h2>
              <p className="text-stone-400 text-lg max-w-2xl mx-auto">主Agent协调器 + 9个专业子Agent，动态组建专家组，协同攻克学习难题</p>
            </DissolveTitle>

            {/* 架构图 */}
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="bg-white/5 backdrop-blur-sm rounded-3xl p-8 border border-white/10 mb-10"
            >
              <div className="text-center mb-8">
                <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30">
                  <Star className="w-5 h-5 text-amber-400" />
                  <span className="text-white font-bold">主Agent · 协调器 Orchestrator</span>
                </div>
                <p className="text-stone-500 text-sm mt-2">生成待办清单 → 动态组建专家组 → 监控执行 → 汇总结果</p>
              </div>

              <div className="grid grid-cols-3 md:grid-cols-9 gap-3 mb-6">
                {agents.map((agent, i) => (<AgentCard key={i} {...agent} index={i} />))}
              </div>

              <div className="flex items-center justify-center gap-4 text-stone-500 text-sm">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500" /> 消息总线</div>
                <span>|</span>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-cyan-500" /> 一次性上下文</div>
                <span>|</span>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-violet-500" /> 多轮收敛</div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ==================== 学习流程 ==================== */}
        <section className="min-h-screen py-24 px-4">
          <div className="max-w-5xl mx-auto">
            <DissolveTitle className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
                从知识到<span className="bg-gradient-to-r from-cyan-400 to-violet-500 bg-clip-text text-transparent">掌握</span>的完整路径
              </h2>
              <p className="text-stone-400 text-lg">六步学习法，让每一遍学习都"过"出效果</p>
            </DissolveTitle>
            <div className="space-y-8">
              {steps.map((item, i) => (
                <div key={i} className="step-item">
                  <StepItem {...item} index={i} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ==================== 技术架构 ==================== */}
        <section className="py-24 px-4">
          <div className="max-w-5xl mx-auto">
            <DissolveTitle className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
                技术<span className="bg-gradient-to-r from-violet-400 to-cyan-500 bg-clip-text text-transparent">架构</span>
              </h2>
            </DissolveTitle>

            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="bg-white/5 backdrop-blur-sm rounded-3xl p-8 md:p-12 border border-white/10"
            >
              {/* 三层架构 */}
              <div className="space-y-6">
                {[
                  { label: '前端层', color: 'from-amber-500/30 to-orange-500/30', border: 'border-amber-500/40', items: ['React 19', 'TypeScript', 'Three.js / R3F', 'TailwindCSS', 'Motion', 'GSAP'] },
                  { label: '服务层', color: 'from-violet-500/30 to-purple-500/30', border: 'border-violet-500/40', items: ['FastAPI', 'PostgreSQL', 'ChromaDB', 'Alembic', 'AgentScope', 'DeepSeek AI'] },
                  { label: 'AI 引擎层', color: 'from-cyan-500/30 to-blue-500/30', border: 'border-cyan-500/40', items: ['RAG 问答', 'FSRS 算法', '9 Agent 系统', '知识图谱', '向量检索', '情绪感知'] },
                ].map((layer, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                    className={`bg-gradient-to-r ${layer.color} rounded-2xl p-6 border ${layer.border}`}
                  >
                    <h3 className="text-lg font-bold text-white mb-3">{layer.label}</h3>
                    <div className="flex flex-wrap gap-2">
                      {layer.items.map((item) => (
                        <span key={item} className="px-3 py-1.5 rounded-lg bg-black/20 backdrop-blur-sm text-stone-300 text-sm border border-white/10">{item}</span>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* 流程连线 */}
              <div className="flex justify-center my-4">
                <div className="flex items-center gap-2 text-stone-500 text-xs">
                  <span>用户</span>
                  <ChevronRightIcon size={12} />
                  <span>前端</span>
                  <ChevronRightIcon size={12} />
                  <span>API</span>
                  <ChevronRightIcon size={12} />
                  <span>AI引擎</span>
                  <ChevronRightIcon size={12} />
                  <span>数据库</span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ==================== FAQ ==================== */}
        <section className="py-24 px-4">
          <div className="max-w-3xl mx-auto">
            <DissolveTitle className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
                常见<span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">问题</span>
              </h2>
            </DissolveTitle>
            <div className="space-y-4">
              {faqs.map((faq, i) => (<FAQItem key={i} {...faq} index={i} />))}
            </div>
          </div>
        </section>

        {/* ==================== CTA ==================== */}
        <section className="py-32 px-4">
          <motion.div initial={{ opacity: 0, scale: 0.9, y: 30 }} whileInView={{ opacity: 1, scale: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: cinematicEase }}
            className="max-w-4xl mx-auto text-center"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-rose-500/20 rounded-3xl blur-3xl" />
              <div className="relative bg-gradient-to-br from-stone-800/90 to-stone-900/90 backdrop-blur-xl rounded-3xl p-12 md:p-16 border border-amber-500/20">
                <h2 className="text-4xl md:text-5xl font-black text-white mb-6">
                  准备好开始你的
                  <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent"> 学习之旅</span>了吗？
                </h2>
                <p className="text-stone-400 text-lg mb-10 max-w-xl mx-auto">无论你是医学生、考研党还是自学者，一遍过都能帮你学得更快、记得更牢</p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Link to="/auth" className="group inline-flex items-center gap-3 px-10 py-5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-2xl shadow-2xl shadow-amber-500/30 hover:shadow-amber-500/50 transition-all duration-300 hover:scale-105">
                    <span className="text-xl">免费开始</span>
                    <ChevronRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
                  </Link>
                  <a href="#features" className="px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-2xl border border-white/20 hover:bg-white/20 transition-all duration-300">了解更多</a>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-4 border-t border-white/10">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-stone-500 text-sm">© 2024 一遍过智能学习平台 · 让学习更高效</p>
            <div className="flex items-center gap-6 text-stone-500 text-sm">
              <a href="#" className="hover:text-amber-400 transition-colors">关于</a>
              <a href="#" className="hover:text-amber-400 transition-colors">帮助</a>
              <a href="#" className="hover:text-amber-400 transition-colors">隐私</a>
            </div>
          </div>
        </footer>
      </div>

      {/* 梯度遮罩 */}
      <div className="fixed inset-0 pointer-events-none z-[3] bg-gradient-to-b from-transparent via-transparent to-stone-900/40" />
    </div>
  )
}
