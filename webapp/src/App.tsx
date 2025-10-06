import { useEffect, useMemo, useState } from "react";

interface VanityRecord { callerNumber: string; bestVanities: string[]; timestamp?: string; }

export default function App() {
  const [records, setRecords] = useState<VanityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiEndpoint = (import.meta.env.VITE_API_ENDPOINT as string) || "https://tuwwne7443.execute-api.us-east-1.amazonaws.com/development/last5";

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(apiEndpoint, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setRecords(Array.isArray(data) ? data : []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [apiEndpoint]);

  const formatted = useMemo(() =>
    records.map(r => ({
      caller: r.callerNumber,
      time: r.timestamp ? new Date(Number(r.timestamp)).toLocaleString() : "",
      vanities: r.bestVanities || []
    })),
  [records]);

  return (
    <div className="container">
      <h1 className="title">Last 5 Vanity Numbers</h1>
      <p className="subtitle">Live results from Amazon Connect callers</p>

      <div className="panel">
        {loading && <div className="hint">Loading…</div>}
        {error && <div className="hint">Failed to load: {error}</div>}
        {!loading && !error && formatted.length === 0 && (
          <div className="hint">No data yet. Place a test call and refresh.</div>
        )}

        <ul className="list">
          {formatted.map((r, i) => (
            <li key={i} className="item">
              <div className="row">
                <span className="badge">Caller</span>
                <span className="phone">{r.caller}</span>
                <span className="spacer" />
                {!!r.time && <span className="time">{r.time}</span>}
              </div>
              <div className="chips">
                {r.vanities.slice(0, 5).map((v, idx) => (
                  <span key={idx} className={idx === 0 ? "chip" : "chip chip-muted"}>{v}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>

        <div className="hint" style={{ marginTop: 14 }}>
          API: <a href={apiEndpoint} target="_blank" rel="noreferrer">{apiEndpoint}</a>
        </div>
      </div>
    </div>
  );
}
