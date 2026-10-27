import type { ReactNode } from "react";

// Root is <div>: a DS component that renders a div somewhere must not make raw <div> a bypass.
export function Card({ children, onClose }: { children?: ReactNode; onClose?: () => void }) {
  return (
    <div className="card">
      <button onClick={onClose}>x</button>
      {children}
    </div>
  );
}
