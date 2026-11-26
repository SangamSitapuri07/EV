"use client";

import { useEffect, useState } from "react";

interface GoogleSignInButtonProps {
  redirectTo?: string;
  label?: string;
}

export function GoogleSignInButton({
  redirectTo = "/dashboard",
  label = "Continue with Google",
}: GoogleSignInButtonProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/auth/session")
      .then((r) => r.json())
      .then((j) => {
        if (active && j?.ok) {
          setConfigured(Boolean(j.data?.providers?.google));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const href = `/api/v1/auth/google?redirectTo=${encodeURIComponent(redirectTo)}`;

  return (
    <div className="space-y-1.5">
      <a
        href={href}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-xs transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
      >
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
          />
        </svg>
        <span>{label}</span>
      </a>
      {configured === false && (
        <p className="text-[11px] text-slate-500 text-center">
          Google OAuth ready — set <code className="font-mono">GOOGLE_CLIENT_ID</code> &amp;{" "}
          <code className="font-mono">GOOGLE_CLIENT_SECRET</code> in <code className="font-mono">.env</code> to activate live sign-in.
        </p>
      )}
    </div>
  );
}
