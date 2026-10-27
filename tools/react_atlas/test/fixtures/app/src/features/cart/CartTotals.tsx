import { useContext } from "react";
import { CartContext } from "./CartContext";

// Seed state_misuse: raw useContext(CartContext) although useCart exists.
export function CartTotals() {
  const { count } = useContext(CartContext);
  return <span>{count}</span>;
}
