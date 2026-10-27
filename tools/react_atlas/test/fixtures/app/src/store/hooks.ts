import { useStore } from "./store";

// Sanctioned access point for components.
export function useAppStore() {
  return useStore();
}
