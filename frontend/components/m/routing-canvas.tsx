"use client";

import { useEffect, useRef, useState } from "react";
import Konva from "konva";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import { exampleRouting } from "@/lib/economics/example-routing";

type Point = { x: number; y: number };
export default function RoutingCanvas({
  stressed,
  playing,
  inspect,
  onInspect,
}: {
  stressed: boolean;
  playing: boolean;
  inspect: number;
  onInspect: (index: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const layer = useRef<Konva.Layer>(null);
  const packets = useRef<(Konva.Circle | null)[]>([]);
  const elapsed = useRef(0);
  const [size, setSize] = useState({ width: 900, height: 365 });
  const [font, setFont] = useState("sans-serif");
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      }),
    );
    observer.observe(target);
    void document.fonts.ready.then(() =>
      setFont(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--font-brand")
          .split(",")[0]
          .replaceAll('"', "")
          .trim() || "sans-serif",
      ),
    );
    return () => observer.disconnect();
  }, []);
  const mobile = size.width < 680;
  const w = size.width,
    h = size.height;
  const route = exampleRouting(stressed);
  const selected = route.selected;
  const origin: Point = mobile
    ? { x: w * 0.22, y: 62 }
    : { x: w * 0.13, y: h / 2 };
  const policy: Point = mobile
    ? { x: w * 0.73, y: 62 }
    : { x: w * 0.39, y: h / 2 };
  const models: Point[] = mobile
    ? [0, 1, 2].map((i) => ({ x: w / 2, y: 202 + i * 82 }))
    : [0, 1, 2].map((i) => ({ x: w * 0.7, y: 75 + i * 105 }));
  const finish: Point = mobile
    ? { x: w / 2, y: 466 }
    : { x: w * 0.93, y: h / 2 };
  const path = mobile
    ? [
        origin,
        policy,
        { x: w - 20, y: policy.y },
        { x: w - 20, y: models[selected].y },
        models[selected],
        { x: 22, y: models[selected].y },
        { x: 22, y: finish.y },
        finish,
      ]
    : [origin, policy, models[selected], finish];
  const pathKey = path.map((p) => `${p.x},${p.y}`).join(" ");
  useEffect(() => {
    if (!playing) return;
    const points = pathKey.split(" ").map((v) => {
      const [x, y] = v.split(",").map(Number);
      return { x, y };
    });
    const animation = new Konva.Animation((frame) => {
      elapsed.current += frame?.timeDiff ?? 0;
      packets.current.forEach((packet, i) => {
        const phase =
          ((elapsed.current / 4200 + i / 3) % 1) * (points.length - 1);
        const index = Math.floor(phase),
          fraction = phase - index;
        const a = points[index],
          b = points[Math.min(index + 1, points.length - 1)];
        packet?.position({
          x: a.x + (b.x - a.x) * fraction,
          y: a.y + (b.y - a.y) * fraction,
        });
      });
    }, layer.current);
    animation.start();
    return () => {
      animation.stop();
    };
  }, [playing, pathKey]);
  const card = (
    point: Point,
    width: number,
    title: string,
    subtitle: string,
    dark = false,
  ) => (
    <Group x={point.x - width / 2} y={point.y - 29}>
      <Rect
        width={width}
        height={58}
        cornerRadius={13}
        fill={dark ? "#06301f" : "#f6f8f5"}
        stroke={dark ? "#06301f" : "#dfe7de"}
      />
      <Text
        x={10}
        y={12}
        width={width - 20}
        text={title}
        align="center"
        fontFamily={font}
        fontStyle="bold"
        fontSize={mobile ? 12 : 14}
        fill={dark ? "#e8f1eb" : "#0e1410"}
      />
      <Text
        x={8}
        y={33}
        width={width - 16}
        text={subtitle}
        align="center"
        fontFamily={font}
        fontSize={9}
        fill={dark ? "#a9f0cc" : "#6e776f"}
      />
    </Group>
  );
  return (
    <div ref={container} className="ml-flow-canvas" aria-hidden="true">
      <Stage width={w} height={h}>
        <Layer ref={layer}>
          {Array.from({ length: 18 }, (_, i) => (
            <Line
              key={i}
              points={[0, i * 30, w, i * 30]}
              stroke="#edf2ec"
              strokeWidth={0.6}
              listening={false}
            />
          ))}
          <Line
            points={[origin.x, origin.y, policy.x, policy.y]}
            stroke="#a9f0cc"
            strokeWidth={2}
          />
          {models.map((point, i) => (
            <Line
              key={i}
              points={
                mobile
                  ? [
                      policy.x,
                      policy.y,
                      w - 20,
                      policy.y,
                      w - 20,
                      point.y,
                      point.x,
                      point.y,
                    ]
                  : [
                      policy.x,
                      policy.y,
                      (policy.x + point.x) / 2,
                      point.y,
                      point.x,
                      point.y,
                    ]
              }
              stroke={selected === i ? "#12b36e" : "#dfe7de"}
              strokeWidth={selected === i ? 2 : 1}
              tension={0.15}
              dash={selected === i ? undefined : [3, 6]}
            />
          ))}
          <Line
            points={
              mobile
                ? [
                    models[selected].x,
                    models[selected].y,
                    22,
                    models[selected].y,
                    22,
                    finish.y,
                    finish.x,
                    finish.y,
                  ]
                : [models[selected].x, models[selected].y, finish.x, finish.y]
            }
            stroke="#12b36e"
            strokeWidth={2}
            dash={[4, 5]}
            tension={0.1}
          />
          {card(origin, mobile ? 108 : 140, "Your request", "Workspace / API")}
          {card(
            policy,
            mobile ? 110 : 152,
            "Policy check",
            "Budget · margin · access",
            true,
          )}
          {models.map((point, i) => (
            <Group
              key={i}
              x={point.x - (mobile ? 104 : 108)}
              y={point.y - 30}
              onClick={() => onInspect(i)}
              onTap={() => onInspect(i)}
              onMouseEnter={(e) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = "pointer";
              }}
              onMouseLeave={(e) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = "default";
              }}
            >
              <Rect
                width={mobile ? 208 : 216}
                height={60}
                cornerRadius={12}
                fill={selected === i ? "#e6f6ec" : "#ffffff"}
                stroke={
                  selected === i
                    ? "#12b36e"
                    : inspect === i
                      ? "#0e1410"
                      : "#dfe7de"
                }
                strokeWidth={selected === i || inspect === i ? 1.5 : 1}
                opacity={stressed && i === 0 ? 0.6 : 1}
              />
              <Circle
                x={22}
                y={30}
                radius={8}
                fill={selected === i ? "#0a6b44" : "#edf2ec"}
              />
              <Text
                x={18}
                y={25}
                text={selected === i ? "✓" : "·"}
                fill={selected === i ? "white" : "#6e776f"}
                fontSize={10}
              />
              <Text
                x={41}
                y={12}
                text={["Premium", "Standard", "Economy"][i]}
                fontFamily={font}
                fontStyle="bold"
                fontSize={13}
                fill="#0e1410"
              />
              <Text
                x={41}
                y={34}
                text={`${Math.round(route.models[i].marginBp / 100)}% margin · ${selected === i ? "selected" : stressed && i === 0 ? "under the floor" : "available"}`}
                fontFamily={font}
                fontSize={10}
                fill={selected === i ? "#0a6b44" : "#6e776f"}
              />
            </Group>
          ))}
          <Circle
            x={finish.x}
            y={finish.y}
            radius={mobile ? 14 : 19}
            fill="#0a6b44"
          />
          <Text
            x={finish.x - 10}
            y={finish.y - 7}
            width={20}
            align="center"
            text="✓"
            fill="white"
            fontSize={14}
          />
          {Array.from({ length: 3 }, (_, i) => (
            <Circle
              ref={(node) => {
                packets.current[i] = node;
              }}
              key={i}
              x={origin.x}
              y={origin.y}
              radius={4}
              fill="#2bd98a"
              stroke="white"
              strokeWidth={1.5}
              listening={false}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
