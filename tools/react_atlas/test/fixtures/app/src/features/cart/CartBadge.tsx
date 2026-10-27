import { useContext } from "react";
import { Input } from "../../components/ui";
import { CartContext } from "./CartContext";

// Consumes CartContext and reaches Input through the ui barrel (re-export).
export function CartBadge() {
  const { count } = useContext(CartContext);
  return <Input value={String(count)} />;
}
