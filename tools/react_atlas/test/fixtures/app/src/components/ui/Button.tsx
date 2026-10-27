import type { ReactNode } from "react";

type Props = {
  variant?: "primary" | "ghost";
  /** @deprecated use variant */
  kind?: string;
  onClick?: () => void;
  children?: ReactNode;
};

export function Button({ variant = "primary", onClick, children, ...rest }: Props) {
  return (
    <button {...rest} className={`btn btn-${variant}`} onClick={onClick}>
      {children}
    </button>
  );
}
