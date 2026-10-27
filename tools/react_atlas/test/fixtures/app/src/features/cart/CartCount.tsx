import { useStore } from "../../store/store";

// Seed state_misuse: reads the base store directly instead of useAppStore.
export function CartCount() {
  const { count } = useStore();
  return <span>{count}</span>;
}
