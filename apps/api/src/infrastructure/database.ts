import type { Pool } from "mysql2/promise";
import { databaseConfig } from "./database-config.js";
import { createMySqlDatabase, type MySqlDatabaseContext } from "./mysql-database.js";
import { createSqliteDatabase, type SqliteDatabase, type SqliteDatabaseContext } from "./sqlite-database.js";

export type DatabaseContext = SqliteDatabaseContext | MySqlDatabaseContext;

export const databaseContext: DatabaseContext =
  databaseConfig.driver === "mysql" && databaseConfig.mysql
    ? await createMySqlDatabase(databaseConfig.mysql)
    : createSqliteDatabase();

export const databaseDriver = databaseContext.driver;

export const db: SqliteDatabase =
  databaseContext.driver === "sqlite" ? databaseContext.db : createUnavailableSqliteDatabase();

export function getMySqlPool(): Pool {
  if (databaseContext.driver !== "mysql") {
    throw new Error("MySQL pool is only available when USE_MYSQL=true.");
  }

  return databaseContext.pool;
}

export async function closeDatabase(): Promise<void> {
  await databaseContext.close();
}

function createUnavailableSqliteDatabase(): SqliteDatabase {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("SQLite database access is unavailable when USE_MYSQL=true.");
      }
    }
  ) as SqliteDatabase;
}
