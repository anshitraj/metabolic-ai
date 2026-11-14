import type { Metadata } from "next";
import { ConsoleShell } from "@/components/m/shell";

export const metadata: Metadata = { title: "Console — Metabolic AI" };

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
