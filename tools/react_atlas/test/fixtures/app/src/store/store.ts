import { create } from "zustand";

type CartState = { count: number; total: number; add: (price: number) => void };

export const useStore = create<CartState>((set) => ({
  count: 0,
  total: 0,
  add: (price) => set({ count: 1, total: price }),
}));
