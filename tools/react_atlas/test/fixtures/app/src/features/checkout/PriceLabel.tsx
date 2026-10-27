// Seed duplicate_component: near-twin of cart/PriceTag.
export function PriceLabel({ value }: { value: number }) {
  return <span className="price">{`$${value.toFixed(2)}`}</span>;
}
