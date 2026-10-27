import { Button } from "../../components/ui/Button";

// Seed wrong_usage: passes the deprecated `kind` prop of Button.
export function Promo() {
  return <Button kind="promo">Promo</Button>;
}
