import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Sparkles } from 'lucide-react'

function OrbitingParticles() {
  const ref = useRef<THREE.Points>(null!)
  const count = 60

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const radius = 2.0 + Math.random() * 0.6
      pos[i * 3] = Math.cos(angle) * radius
      pos[i * 3 + 1] = Math.sin(angle) * radius
      pos[i * 3 + 2] = (Math.random() - 0.5) * 1.2
    }
    return pos
  }, [])

  useFrame(({ clock }) => {
    ref.current.rotation.z = clock.getElapsedTime() * 0.15
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        color="#f59e0b"
        transparent
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  )
}

function GlowRing() {
  const ref = useRef<THREE.Mesh>(null!)

  useFrame(({ clock }) => {
    const s = 1 + Math.sin(clock.getElapsedTime() * 0.6) * 0.06
    ref.current.scale.setScalar(s)
    ref.current.rotation.z = clock.getElapsedTime() * 0.08
  })

  return (
    <mesh ref={ref}>
      <ringGeometry args={[1.4, 1.7, 48]} />
      <meshBasicMaterial
        color="#f59e0b"
        transparent
        opacity={0.12}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

function MiniShapes() {
  const groupRef = useRef<THREE.Group>(null!)
  const count = 10

  const shapes = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2
      const radius = 2.6 + Math.random() * 0.5
      return {
        position: [
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          (Math.random() - 0.5) * 2,
        ] as [number, number, number],
        type: i % 3,
        color: i % 2 === 0 ? '#f59e0b' : '#ea580c',
      }
    })
  }, [])

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.12
      groupRef.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.04) * 0.04
    }
  })

  return (
    <group ref={groupRef}>
      {shapes.map((s, i) => (
        <mesh key={i} position={s.position} scale={0.18}>
          {s.type === 0 ? (
            <icosahedronGeometry args={[0.5, 0]} />
          ) : s.type === 1 ? (
            <octahedronGeometry args={[0.5, 0]} />
          ) : (
            <torusGeometry args={[0.3, 0.08, 8, 12]} />
          )}
          <meshBasicMaterial
            color={s.color}
            transparent
            opacity={0.15}
            wireframe={s.type !== 2}
          />
        </mesh>
      ))}
    </group>
  )
}

export default function AgentHeroGlow() {
  return (
    <div className="relative w-24 h-24 mx-auto mb-5">
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-400/20 via-orange-500/10 to-transparent blur-2xl animate-pulse" />
      <div className="absolute inset-2 rounded-full bg-gradient-to-br from-amber-500/25 to-orange-600/15 blur-xl" />
      <div className="absolute inset-4 rounded-full bg-gradient-to-br from-amber-400/35 to-orange-500/25 blur-lg" />
      <div className="absolute inset-0 pointer-events-none" style={{ transform: 'scale(1.8)' }}>
        <Canvas
          camera={{ position: [0, 0, 5], fov: 40 }}
          gl={{ alpha: true, antialias: true }}
          dpr={[1, 2]}
        >
          <GlowRing />
          <OrbitingParticles />
          <MiniShapes />
        </Canvas>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-2xl shadow-amber-500/40">
          <Sparkles className="w-7 h-7 text-white" />
        </div>
      </div>
    </div>
  )
}
