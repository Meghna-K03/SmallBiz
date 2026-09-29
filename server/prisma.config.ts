import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// The Prisma CLI (migrate, seed) connects through DIRECT_URL (session pooler).
// The runtime client uses DATABASE_URL (see src/lib/prisma.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL,
  },
})
