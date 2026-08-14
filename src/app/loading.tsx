/** The console loads. Shown while the server resolves the operator. */
export default function Loading() {
  return (
    <main className="wrap" aria-busy="true" aria-label="The console loads now">
      <div className="panel">
        <div className="skeleton" style={{ width: "38%", height: "1.2rem" }} />
        <div className="skeleton" style={{ width: "62%" }} />
      </div>
      <div className="panel">
        <div className="skeleton" style={{ width: "90%", height: "3.5rem" }} />
      </div>
    </main>
  );
}
