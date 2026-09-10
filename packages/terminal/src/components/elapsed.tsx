import { useEffect, useState } from 'react';
import { formatElapsed } from '../lib/clock.js';
import { Text } from './text.js';

/**
 * Time in the room, as a leaf so its tick re-renders one `Text` rather than the room. It
 * still checks every second, but `formatElapsed` only changes every minute after the first,
 * and an unchanged string is a state update React drops — no frame.
 */
export function Elapsed({ since }: { since: number | null }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!since) return;
    const update = () => setLabel(formatElapsed(Date.now() - since));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [since]);

  return label ? <Text dimColor>{label}</Text> : null;
}
