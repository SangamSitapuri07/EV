import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function created<T>(data: T) {
  return NextResponse.json({ ok: true, data }, { status: 201 });
}

export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    { status }
  );
}

export function handleApiError(err: unknown) {
  if (err instanceof AppError) {
    return apiError(err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request payload", err.flatten());
  }
  console.error("[API_ERROR]", err);
  return apiError(500, "INTERNAL_ERROR", "An unexpected server error occurred");
}
