import { Object3DNode, MaterialNode, LightNode, BufferGeometryNode, TextureNode } from '@react-three/fiber'
import * as THREE from 'three'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      mesh: Object3DNode<THREE.Mesh, typeof THREE.Mesh>
      group: Object3DNode<THREE.Group, typeof THREE.Group>
      boxGeometry: BufferGeometryNode<THREE.BoxGeometry, typeof THREE.BoxGeometry>
      sphereGeometry: BufferGeometryNode<THREE.SphereGeometry, typeof THREE.SphereGeometry>
      cylinderGeometry: BufferGeometryNode<THREE.CylinderGeometry, typeof THREE.CylinderGeometry>
      planeGeometry: BufferGeometryNode<THREE.PlaneGeometry, typeof THREE.PlaneGeometry>
      meshStandardMaterial: MaterialNode<THREE.MeshStandardMaterial, typeof THREE.MeshStandardMaterial>
      meshBasicMaterial: MaterialNode<THREE.MeshBasicMaterial, typeof THREE.MeshBasicMaterial>
      meshPhongMaterial: MaterialNode<THREE.MeshPhongMaterial, typeof THREE.MeshPhongMaterial>
      pointsMaterial: MaterialNode<THREE.PointsMaterial, typeof THREE.PointsMaterial>
      lineBasicMaterial: MaterialNode<THREE.LineBasicMaterial, typeof THREE.LineBasicMaterial>
      ambientLight: LightNode<THREE.AmbientLight, typeof THREE.AmbientLight>
      directionalLight: LightNode<THREE.DirectionalLight, typeof THREE.DirectionalLight>
      pointLight: LightNode<THREE.PointLight, typeof THREE.PointLight>
      spotLight: LightNode<THREE.SpotLight, typeof THREE.SpotLight>
      bufferGeometry: BufferGeometryNode<THREE.BufferGeometry, typeof THREE.BufferGeometry>
      lineSegments: Object3DNode<THREE.LineSegments, typeof THREE.LineSegments>
      edgesGeometry: BufferGeometryNode<THREE.EdgesGeometry, typeof THREE.EdgesGeometry>
    }
  }
}

export {}
