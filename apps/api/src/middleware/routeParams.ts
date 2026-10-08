import type { Request } from "express";
import { AppError } from "./errorHandler";

/**
 * A path parameter, guaranteed to be a string.
 *
 * Express only reaches a handler whose route matched, so `req.params.id` is always present at run
 * time — but its type is `string | undefined`, and under `noUncheckedIndexedAccess` every one of
 * those reached Prisma as a maybe-undefined value in a required column. This makes the guarantee
 * real rather than asserting it away at each call site: a parameter that is genuinely missing is a
 * 400 naming it, not a write with `undefined` in it.
 *
 * The alternative — `req.params.id as string` — would have removed the same errors while leaving
 * the compiler unable to help at the next call site, which is the opposite of the point.
 */
export function routeParam(req: Request, name: string): string {
  const value = req.params?.[name];
  if (typeof value !== "string" || value === "") {
    throw new AppError(`This request is missing its ${name}`, 400);
  }
  return value;
}
