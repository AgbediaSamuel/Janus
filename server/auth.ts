import type { Request, Response, NextFunction } from "express";
import { liveMode, supabaseAdmin, HttpError } from "./config";

export interface Identity {
  userId: string;
  organizationIds: string[];
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!liveMode) {
      res.locals.identity = {
        userId: "local-demo",
        organizationIds: ["notion", "aws", "google"],
      } satisfies Identity;
      next();
      return;
    }
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer) throw new HttpError(401, "Sign in to Janus to continue");
    const client = supabaseAdmin();
    const { data, error } = await client.auth.getUser(bearer);
    if (error || !data.user)
      throw new HttpError(401, "Your session is invalid or expired");
    const memberships = await client
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", data.user.id);
    if (memberships.error) throw memberships.error;
    res.locals.identity = {
      userId: data.user.id,
      organizationIds: memberships.data.map((row) => row.organization_id),
    } satisfies Identity;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireOrganization(res: Response, organizationId: string) {
  const identity = res.locals.identity as Identity;
  if (!identity.organizationIds.includes(organizationId))
    throw new HttpError(403, "You do not belong to this organization");
  return identity;
}
