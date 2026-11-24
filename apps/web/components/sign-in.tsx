"use client";
import { useActionState } from "react";
import { signIn } from "@/lib/actions";

export function SignIn() {
  const [said, act, busy] = useActionState(signIn, {});
  return (
    <form action={act} className="sheet mt-6 flex flex-col gap-3 p-5">
      <label className="flex flex-col gap-1">
        Email
        <input
          className="field"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue="owner@northlight.example"
        />
      </label>
      <label className="flex flex-col gap-1">
        Password
        <input
          className="field"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          defaultValue="demo"
        />
      </label>
      <button className="btn btn-main" disabled={busy} type="submit">
        {busy ? "Signing in" : "Sign in"}
      </button>
      <p role="alert" className="min-h-6 text-down">
        {said.error}
      </p>
    </form>
  );
}
