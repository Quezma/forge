import { useContext } from "react";
import { CartContext } from "./CartContext";

// Sanctioned access point for CartContext.
export function useCart() {
  return useContext(CartContext);
}
