export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  maxFileSize: 50 * 1024 * 1024, // 50MB
  corsOrigin: process.env.CORS_ORIGIN ?? (process.env.NODE_ENV === 'production' ? true : 'http://localhost:5173'),
  maxParticipantsPerRoom: 6,
} as const;
