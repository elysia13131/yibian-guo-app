import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function Particles() {
  const ref = useRef<THREE.Points>(null!)

  const [positions, sizes] = useMemo(() => {
    const count = 400
    const pos = new Float32Array(count * 3)
    const siz = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40
      pos[i * 3 + 1] = (Math.random() - 0.5) * 30
      pos[i * 3 + 2] = (Math.random() - 0.5) * 20
      siz[i] = Math.random() * 3 + 1
    }
    return [pos, siz]
  }, [])

  useFrame((_, delta) => {
    ref.current.rotation.y += delta * 0.02
    ref.current.rotation.x += delta * 0.008
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-size"
          count={sizes.length}
          array={sizes}
          itemSize={1}
          args={[sizes, 1]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        color="#d97706"
        transparent
        opacity={0.6}
        sizeAttenuation
        blending={THREE.NormalBlending}
        depthWrite={false}
      />
    </points>
  )
}

function MiniHelix({ position, scale }: { position: [number, number, number]; scale: number }) {
  const groupRef = useRef<THREE.Group>(null!)
  const segments = 16
  const helixRadius = 0.3
  const height = 1.2

  const pointsA = useMemo(() => {
    const pts: [number, number, number][] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const angle = t * Math.PI * 4
      pts.push([Math.cos(angle) * helixRadius, t * height - height / 2, Math.sin(angle) * helixRadius])
    }
    return pts
  }, [])

  const pointsB = useMemo(() => {
    const pts: [number, number, number][] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const angle = t * Math.PI * 4 + Math.PI
      pts.push([Math.cos(angle) * helixRadius, t * height - height / 2, Math.sin(angle) * helixRadius])
    }
    return pts
  }, [])

  const rungPairs: { from: [number, number, number]; to: [number, number, number]; mid: [number, number, number]; angle: number; color: string }[] = useMemo(() => {
    const items = []
    for (let i = 0; i < segments; i += 4) {
      const t = i / segments
      const angle = t * Math.PI * 4
      const y = t * height - height / 2
      const ax = Math.cos(angle) * helixRadius
      const az = Math.sin(angle) * helixRadius
      const bx = Math.cos(angle + Math.PI) * helixRadius
      const bz = Math.sin(angle + Math.PI) * helixRadius
      const colors = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa']
      items.push({
        from: [ax, y, az] as [number, number, number],
        to: [bx, y, bz] as [number, number, number],
        mid: [(ax + bx) / 2, y, (az + bz) / 2] as [number, number, number],
        angle,
        color: colors[i % colors.length],
      })
    }
    return items
  }, [])

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.3 + position[0]
    }
  })

  return (
    <group ref={groupRef} position={position} scale={scale}>
      {pointsA.slice(0, -1).map((_, i) => {
        const p = pointsA[i]
        const n = pointsA[i + 1]
        const mid = [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2, (p[2] + n[2]) / 2] as [number, number, number]
        const dx = n[0] - p[0], dy = n[1] - p[1], dz = n[2] - p[2]
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
        return (
          <mesh key={`tA-${i}`} position={mid}>
            <cylinderGeometry args={[0.035, 0.035, len, 4]} />
            <meshBasicMaterial color="#60a5fa" transparent opacity={0.5} />
          </mesh>
        )
      })}
      {pointsB.slice(0, -1).map((_, i) => {
        const p = pointsB[i]
        const n = pointsB[i + 1]
        const mid = [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2, (p[2] + n[2]) / 2] as [number, number, number]
        const dx = n[0] - p[0], dy = n[1] - p[1], dz = n[2] - p[2]
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
        return (
          <mesh key={`tB-${i}`} position={mid}>
            <cylinderGeometry args={[0.035, 0.035, len, 4]} />
            <meshBasicMaterial color="#f472b6" transparent opacity={0.5} />
          </mesh>
        )
      })}
      {rungPairs.map((item, i) => {
        const dx = item.to[0] - item.from[0]
        const dy = item.to[1] - item.from[1]
        const dz = item.to[2] - item.from[2]
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
        return (
          <mesh key={`r-${i}`} position={item.mid} rotation={[Math.PI / 2, -item.angle, 0]}>
            <boxGeometry args={[0.03, len, 0.08]} />
            <meshBasicMaterial color={item.color} transparent opacity={0.3} />
          </mesh>
        )
      })}
    </group>
  )
}

function FloatingHelices() {
  const groupRef = useRef<THREE.Group>(null!)

  const helices = useMemo(() => {
    const count = 5
    return Array.from({ length: count }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 12 - 3,
      ] as [number, number, number],
      scale: 0.7 + Math.random() * 0.6,
      speed: 0.08 + Math.random() * 0.15,
      offset: Math.random() * Math.PI * 2,
    }))
  }, [])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    groupRef.current.children.forEach((child, i) => {
      const h = helices[i]
      if (h) {
        child.position.y += Math.sin(t * h.speed + h.offset) * 0.002
        child.position.x += Math.cos(t * h.speed * 0.6 + h.offset) * 0.001
      }
    })
  })

  return (
    <group ref={groupRef}>
      {helices.map((h, i) => (
        <MiniHelix key={i} position={h.position} scale={h.scale} />
      ))}
    </group>
  )
}

function FloatingShapes() {
  const groupRef = useRef<THREE.Group>(null!)

  const shapes = useMemo(() => {
    const count = 6
    return Array.from({ length: count }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 10 - 5,
      ] as [number, number, number],
      scale: Math.random() * 0.8 + 0.3,
      speed: 0.1 + Math.random() * 0.2,
      offset: Math.random() * Math.PI * 2,
    }))
  }, [])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    groupRef.current.children.forEach((child, i) => {
      const s = shapes[i]
      if (s) {
        child.position.y += Math.sin(t * s.speed + s.offset) * 0.001
      }
    })
  })

  return (
    <group ref={groupRef}>
      {shapes.map((s, i) => {
        const isRing = i % 2 === 0
        return (
          <mesh
            key={i}
            position={s.position}
            scale={s.scale}
          >
            {isRing ? (
              <ringGeometry args={[0.3, 0.5, 24]} />
            ) : (
              <icosahedronGeometry args={[0.4, 0]} />
            )}
            <meshBasicMaterial
              color={i % 3 === 0 ? '#d97706' : i % 3 === 1 ? '#ea580c' : '#7c3aed'}
              transparent
              opacity={0.2}
              wireframe={!isRing}
            />
          </mesh>
        )
      })}
    </group>
  )
}

export default function ParticleField() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      <Canvas
        camera={{ position: [0, 0, 15], fov: 60 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
      >
        <Particles />
        <FloatingHelices />
        <FloatingShapes />
      </Canvas>
    </div>
  )
}
