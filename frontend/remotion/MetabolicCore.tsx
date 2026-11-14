import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame, useVideoConfig } from "remotion";

/** All motion derives from the requested frame, including the 3D rotations. */
export function MetabolicCore({
  width,
  height,
  color = "#2bd98a",
}: {
  width: number;
  height: number;
  color?: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <ThreeCanvas
      width={Math.round(width)}
      height={Math.round(height)}
      camera={{ position: [0, 0, 6.7], fov: 35 }}
      gl={{ alpha: true, antialias: true }}
      dpr={1}
    >
      <ambientLight intensity={1.2} />
      <directionalLight position={[3, 4, 5]} intensity={3.2} color="#e8fff0" />
      <pointLight position={[-3, -2, 3]} intensity={28} color={color} />
      <group
        rotation={[0.24 + Math.sin(t * 0.3) * 0.08, t * 0.2, -0.2]}
        scale={1 + Math.sin(t * 1.7) * 0.025}
      >
        <mesh>
          <icosahedronGeometry args={[0.96, 3]} />
          <meshPhysicalMaterial
            color={color}
            metalness={0.62}
            roughness={0.23}
            clearcoat={1}
            clearcoatRoughness={0.13}
          />
        </mesh>
        <mesh rotation={[0.25, 0.2, t * 0.13]}>
          <torusKnotGeometry args={[1.12, 0.018, 128, 6, 2, 3]} />
          <meshStandardMaterial
            color="#a9f0cc"
            metalness={0.75}
            roughness={0.3}
          />
        </mesh>
        {[0, 1, 2].map((i) => (
          <group
            key={i}
            rotation={[0.4 + i * 0.7, 0.25 + i * 0.6, t * (i % 2 ? -0.2 : 0.2)]}
          >
            <mesh>
              <torusGeometry args={[1.46 + i * 0.12, 0.012, 6, 96]} />
              <meshStandardMaterial
                color="#a9f0cc"
                metalness={0.8}
                roughness={0.3}
                transparent
                opacity={0.5}
              />
            </mesh>
            <mesh position={[1.46 + i * 0.12, 0, 0]}>
              <sphereGeometry args={[0.06, 12, 12]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive={color}
                emissiveIntensity={0.5}
              />
            </mesh>
          </group>
        ))}
      </group>
    </ThreeCanvas>
  );
}
