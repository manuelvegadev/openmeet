export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  maxParticipantsPerRoom: 6,
} as const;
