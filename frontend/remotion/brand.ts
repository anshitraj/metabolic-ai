import { useEffect, useState } from "react";
import { loadFont } from "@remotion/fonts";
import {
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
} from "remotion";

export const BRAND = {
  paper: "#f6f8f5",
  surface: "#ffffff",
  ink: "#0e1410",
  muted: "#6e776f",
  green: "#0a6b44",
  dark: "#06301f",
  mint: "#2bd98a",
  pale: "#a9f0cc",
  line: "#dfe7de",
  font: "Metabolic Motion",
};
let font: Promise<void> | null = null;
export function useBrandFont() {
  const [handle] = useState(() =>
    delayRender("Loading the Metabolic brand font"),
  );
  useEffect(() => {
    font ??= loadFont({
      family: BRAND.font,
      url: staticFile("fonts/Manrope-Variable.ttf"),
      weight: "200 800",
    });
    void font.then(() => continueRender(handle)).catch(cancelRender);
  }, [handle]);
}
