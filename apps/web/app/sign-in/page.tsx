import { SignIn } from "@/components/sign-in";
export default function Page() {
  return (
    <main className="mx-auto mt-[12vh] max-w-sm px-4">
      <h1>Wavekeep</h1>
      <p className="mt-1 text-soft">Whether AI assistants name you, and whether that changed.</p>
      <SignIn />
    </main>
  );
}
