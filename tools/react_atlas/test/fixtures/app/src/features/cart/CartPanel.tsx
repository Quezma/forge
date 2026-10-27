// Clean: raw structural <div> and a dynamic inline style are legitimate.
export function CartPanel({ index }: { index: number }) {
  return <div style={{ animationDelay: `${index * 50}ms` }}>panel</div>;
}
