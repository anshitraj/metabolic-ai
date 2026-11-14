import { Composition, registerRoot } from "remotion";
import {
  MetabolicBrandLoop,
  MetabolicPromo,
  PROMO_FPS,
  PROMO_FRAMES,
} from "./MetabolicPromo";
function Root() {
  return (
    <>
      {[
        { id: "Metabolic-Wide", width: 1920, height: 1080 },
        { id: "Metabolic-Square", width: 1080, height: 1080 },
        { id: "Metabolic-Vertical", width: 1080, height: 1920 },
      ].map((format) => (
        <Composition
          key={format.id}
          {...format}
          component={MetabolicPromo}
          fps={PROMO_FPS}
          durationInFrames={PROMO_FRAMES}
        />
      ))}
      <Composition
        id="Metabolic-Brand-Loop"
        component={MetabolicBrandLoop}
        width={1200}
        height={680}
        fps={30}
        durationInFrames={240}
      />
    </>
  );
}
registerRoot(Root);
