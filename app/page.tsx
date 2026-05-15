"use client";
import { useState } from "react";

export default function Page() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<any>(null);

  async function analyze() {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setResult(await res.json());
  }

  return (
    <main style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>Cognitive Engagement Insight</h1>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={18}
        style={{ width: "100%", padding: 10, marginTop: 12 }}
      />

      <div style={{ marginTop: 10 }}>
        <button onClick={analyze}>Analyze</button>
      </div>

      {result && (
        <pre style={{ marginTop: 12, background: "#eee", padding: 10, overflow: "auto" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}