import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { UserRole } from '@prisma/client'
import { z } from 'zod'
import { env } from '../lib/env.js'
import { prisma } from '../lib/prisma.js'

type AuthPayload = {
  sub: number
  role: UserRole
  email: string
}

const authPayloadSchema = z.object({
  sub: z.number(),
  role: z.nativeEnum(UserRole),
  email: z.string().email(),
})

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload
    }
  }
}

export const requireAuth = (roles?: UserRole[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization
    const bearerToken = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
    const cookieToken = req.cookies?.access_token as string | undefined
    const token = bearerToken ?? cookieToken

    if (!token) {
      res.status(401).json({ error: 'Missing auth token' })
      return
    }

    try {
      const decoded = jwt.verify(token, env.jwtSecret)
      const payload = authPayloadSchema.safeParse(decoded)
      if (!payload.success) {
        res.status(401).json({ error: 'Invalid token payload' })
        return
      }
      req.auth = payload.data as AuthPayload

      try {
        const user = await prisma.user.findUnique({
          where: { id: req.auth.sub },
          select: { isSuspended: true },
        })

        if (!user) {
          res.status(401).json({ error: 'User not found' })
          return
        }

        if (user.isSuspended) {
          res.status(423).json({ error: 'Account suspended' })
          return
        }
      } catch {
        // Allow local fallback auth flow when DB is unavailable.
      }

      if (roles && roles.length > 0 && !roles.includes(payload.data.role)) {
        res.status(403).json({ error: 'Forbidden for this role' })
        return
      }

      next()
    } catch {
      res.status(401).json({ error: 'Invalid token' })
    }
  }
}
