import { useAppStore } from "../../store/hooks";

// Clean counterpart: goes through the useAppStore wrapper.
export function Total() {
  const { total } = useAppStore();
  return <span>{total}</span>;
}
