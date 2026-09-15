import { WebSocket } from 'ws';
import type { FileOffer, FileOfferBroadcastMessage } from './protocol.js';
import type { ConnectedClient } from './types.js';

/** The four kinds a row can draw. Anything else becomes `doc`. */
const KINDS = new Set(['aud', 'vid', 'img', 'zip', 'doc']);

/**
 * Announce a file to the room. The server forwards the description and nothing else — the
 * request and the bytes travel over the peer connections — so this is the whole of its part
 * in a transfer, and it keeps no record of it.
 *
 * Who the sender is comes from the connection, never from the message, exactly as it does
 * for chat. Everything else is the sender's own claim and is checked again on arrival: a
 * receiver verifies the size and the digest against the bytes it actually got, and builds
 * the path it saves to itself.
 */
export function handleFileOffer(
  message: FileOffer,
  sender: ConnectedClient,
  roomClients: Map<string, ConnectedClient>,
): void {
  if (typeof message.id !== 'string' || !message.id) return;
  if (typeof message.name !== 'string' || !message.name) return;
  if (typeof message.size !== 'number' || !Number.isFinite(message.size) || message.size < 0) return;

  const broadcast: FileOfferBroadcastMessage = {
    type: 'file-offer-broadcast',
    offer: {
      ...message,
      id: message.id.slice(0, 64),
      name: message.name.slice(0, 255),
      kind: KINDS.has(message.kind) ? message.kind : 'doc',
      sha256: typeof message.sha256 === 'string' ? message.sha256.slice(0, 64) : '',
      fromId: sender.participantId,
      username: sender.username,
      color: sender.color,
      timestamp: Date.now(),
    },
  };

  const data = JSON.stringify(broadcast);
  for (const [, client] of roomClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}
