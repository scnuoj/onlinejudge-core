/**
 * config
 */
export interface IRedisConfig {
  host: string
  port: number
  password: string
  db: number
}
export interface IMysqlConfig {
  host: string
  user: string
  port: number
  password: string
  database: string
}
export interface IConfig {
  redis: IRedisConfig
  mysql: IMysqlConfig
}
export const config: IConfig = {
  redis: {
    host: process.env.RE_HOST || '127.0.0.1',
    port: process.env.RE_PORT || 5379,
    password: process.env.RE_PASSWORD || '',
    db: 0
  },
  mysql: {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USERNAME || 'root',
    port: process.env.DB_PORT || 2306,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'onlinejudge'
  }
}
