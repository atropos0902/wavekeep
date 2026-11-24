export function NoPermission() {
  return (
    <section className="py-8">
      <h1>This screen is for the agency's staff</h1>
      <p className="mt-2 text-soft">Your account sees approved reports. Open the reports screen to read them.</p>
    </section>
  );
}
export function NoWave() {
  return (
    <section className="py-8">
      <h1>No wave has been counted yet</h1>
      <p className="mt-2 text-soft">Start one from the waves screen. Numbers appear here once it closes.</p>
    </section>
  );
}
