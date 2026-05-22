import "./runtime.js";

export type DatabaseDriver = "sqlite" | "mysql";

export interface MySqlDatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  createDatabase: boolean;
}

export interface DatabaseConfig {
  driver: DatabaseDriver;
  mysql?: MySqlDatabaseConfig;
}

function parseDatabaseDriverFromUseMySql(value: string | undefined): DatabaseDriver {
  return parseBoolean(value) ? "mysql" : "sqlite";
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when USE_MYSQL=true.`);
  }

  return value;
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "3306", 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error("MYSQL_PORT must be a valid TCP port.");
  }

  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseMySqlConfig(): MySqlDatabaseConfig {
  return {
    host: requiredEnv("MYSQL_HOST"),
    port: parsePort(process.env.MYSQL_PORT),
    user: requiredEnv("MYSQL_USER"),
    password: process.env.MYSQL_PASSWORD ?? "",
    database: requiredEnv("MYSQL_DATABASE"),
    connectionLimit: parsePositiveInteger(process.env.MYSQL_CONNECTION_LIMIT, 10, "MYSQL_CONNECTION_LIMIT"),
    createDatabase: parseBoolean(process.env.MYSQL_CREATE_DATABASE)
  };
}

const driver = parseDatabaseDriverFromUseMySql(process.env.USE_MYSQL);

export const databaseConfig: DatabaseConfig = {
  driver,
  mysql: driver === "mysql" ? parseMySqlConfig() : undefined
};
