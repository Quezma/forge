import { Button } from "../../components/ui/Button";

// Clean counterpart: uses the design-system Button.
export function Summary({ onPay }: { onPay: () => void }) {
  return <Button onClick={onPay}>Pay</Button>;
}
