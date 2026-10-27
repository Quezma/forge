// Minimal type shim so the fixture type-checks without installing React.
declare module "react" {
  export type ReactNode = string | number | null | undefined | JSX.Element | ReactNode[];
  export interface Context<T> { value: T }
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
  export function useState<T>(initial: T): [T, (v: T) => void];
}
declare module "react/jsx-runtime" {
  export const jsx: unknown;
  export const jsxs: unknown;
  export const Fragment: unknown;
}
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [tag: string]: Record<string, unknown>;
  }
  interface ElementChildrenAttribute {
    children: {};
  }
}
declare module "zustand" {
  export function create<T>(init: (set: (partial: Partial<T>) => void) => T): () => T;
}
