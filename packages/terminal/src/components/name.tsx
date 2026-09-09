import { bracketed, colorForName } from '../lib/identity.js';
import { Text } from './text.js';

interface NameProps {
  name: string;
  /** The chosen colour; hashed from the name when missing (see `colorForName`). */
  color?: string | null;
  bold?: boolean;
}

/** A participant's name the one way it is ever shown: `[name]`, brackets included, in their colour. */
export function Name({ name, color, bold }: NameProps) {
  return (
    <Text color={colorForName(name, color)} bold={bold}>
      {bracketed(name)}
    </Text>
  );
}
