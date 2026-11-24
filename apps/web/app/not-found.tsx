import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1>These numbers aren't here</h1>
      <p className="mt-2 text-soft">
        The link may name a wave that hasn't been counted under these names, or one in another workspace.
      </p>
      <Link className="btn mt-4 inline-block" href="/">
        Go to the latest wave
      </Link>
    </main>
  );
}
