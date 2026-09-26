import postgres from "postgres";
import type { AppEnv } from "../env";
import { DemoRepository } from "./memory";
import { PostgresRepository } from "./postgres";
import type { AppRepository } from "./types";
import { requirePersistentDatabase } from "../runtimeConfig";

let memoryRepository: DemoRepository | null = null;
const postgresRepositories = new Map<string, PostgresRepository>();

export function createRepository(env: AppEnv): AppRepository {
  requirePersistentDatabase(env);
  const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL || env.POSTGRES_URL;
  if (connectionString) {
    const cacheKey = JSON.stringify([connectionString, env.DATABASE_SSL]);
    const existingRepository = postgresRepositories.get(cacheKey);
    if (existingRepository) return existingRepository;
    const sql = postgres(connectionString, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      ...(env.DATABASE_SSL ? { ssl: ["false", "disable"].includes(env.DATABASE_SSL) ? false : "require" as const } : {})
    });
    const repository = new PostgresRepository(sql);
    postgresRepositories.set(cacheKey, repository);
    return repository;
  }
  if (!memoryRepository) memoryRepository = new DemoRepository();
  return memoryRepository;
}
