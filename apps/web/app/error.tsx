"use client";
export default function Broken({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1>This page didn't load</h1>
      <p className="mt-2 text-soft">Nothing was changed. The failure is in the log.</p>
      <button type="button" className="btn mt-4" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
