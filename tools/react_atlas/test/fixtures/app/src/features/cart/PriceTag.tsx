// Seed duplicate_component: near-twin of checkout/PriceLabel.
export function PriceTag({ amount }: { amount: number }) {
  return <span className="price">{`$${amount.toFixed(2)}`}</span>;
}
