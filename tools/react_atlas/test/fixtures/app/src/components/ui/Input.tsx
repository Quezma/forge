type Props = { value: string; onChange?: (v: string) => void };

export function Input({ value }: Props) {
  return <input className="input" value={value} />;
}
