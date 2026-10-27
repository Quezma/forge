# Fixture app

Small React + TypeScript app used by react-atlas tests. Not installed (no node_modules); `src/react-shim.d.ts` stands in for React and zustand types.

| Seed | File | Intended check |
| --- | --- | --- |
| ds_bypass | `src/features/cart/CartButton.tsx` | raw `<button>` with inline style; should use `ui/Button` |
| duplicate_component | `src/features/cart/PriceTag.tsx` + `src/features/checkout/PriceLabel.tsx` | near-identical components |
| state_misuse | `src/features/cart/CartCount.tsx` | uses base `useStore` instead of `useAppStore` |
| wrong_usage | `src/features/checkout/Legacy.tsx` | renders `@deprecated` `ui/OldCard` |
| state_misuse (context) | `src/features/cart/CartTotals.tsx` (and `CartBadge.tsx`) | raw `useContext(CartContext)`; `useCart.ts` is the wrapper |
| wrong_usage (prop) | `src/features/checkout/Promo.tsx` | passes `@deprecated` Button prop `kind` |
| clean | `src/features/checkout/Summary.tsx` | uses `ui/Button`; no ds_bypass |
| clean | `src/features/checkout/Total.tsx` | uses `useAppStore`; no state_misuse |
| design system | `src/components/ui/{Button,Input,OldCard}.tsx` | reference components |
| context + barrel | `src/features/cart/{CartContext.ts,CartBadge.tsx}`, `src/components/ui/index.ts` | `CartBadge` reads `CartContext` via `useContext` and imports `Input` through the barrel |
| clean (structural + dynamic) | `src/features/cart/CartPanel.tsx` | raw `<div>` and a dynamic inline style; `ui/Card` has a `<div>` root, so neither is a ds_bypass |
| design system (div root) | `src/components/ui/Card.tsx` | renders a `<button>` inside a `<div>` root: wraps `div` (structural, ignored), not `button` |
| not indexed | `src/features/cart/PriceTag.test.tsx` | test files contribute no symbols, usages or styles |

Tests copy the app to add a third `PriceTag` twin (cluster of 3 -> 2 findings) and to seed outlier props.
