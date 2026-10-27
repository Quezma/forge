import type { ReactNode } from "react";

/** @deprecated use Card */
export function OldCard({ children }: { children?: ReactNode }) {
  return <div className="old-card">{children}</div>;
}
