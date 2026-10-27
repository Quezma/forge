import { createContext } from "react";

export const CartContext = createContext<{ count: number }>({ count: 0 });
