import dotenv from 'dotenv'

dotenv.config()

type CookieSameSite = 'lax' | 'strict' | 'none'

const parseCookieSameSite = (): CookieSameSite => {
  const value = process.env.COOKIE_SAME_SITE
  if (value === 'none' || value === 'strict' || value === 'lax') {
    return value
  }
  return 'lax'
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'unsafe-dev-secret',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 14),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  cookieSameSite: parseCookieSameSite(),
  cookieDomain: process.env.COOKIE_DOMAIN?.trim() || undefined,
  corsOrigin: process.env.CORS_ORIGIN?.trim() || '',
}
