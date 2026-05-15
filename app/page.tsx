"use client";

import { useState } from "react";

export default function Page() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<any>(null);

  async function analyze() {
    try {
      const res = await fetch("http://localhost:8787/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <main style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>Cognitive Engagement Insight</h1>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={20}
        style={{
          width: "100%",
          padding: 10,
          marginTop: 20,
        }}
      />

      <br />
      <br />

      <button onClick={analyze}>Analyze</button>

      {result && (
        <div style={{ marginTop: 30 }}>
          <h2>Results</h2>

          <p>
            <strong>Cognitive Engagement:</strong>{" "}
            {result?.level1?.E ?? "—"}
          </p>

          <p>
            <strong>Conceptual Participation:</strong>{" "}
            {result?.level1?.CP ?? "—"}
          </p>

          <p>
            <strong>Collaborative Index:</strong>{" "}
            {result?.level1?.collaborativeIndex ?? "—"}
          </p>

          <p>
            <strong>User Turns:</strong>{" "}
            {result?.meta?.userTurnsCount ?? "—"}
          </p>

          <pre
            style={{
              marginTop: 20,
              background: "#eee",
              padding: 10,
              overflow: "auto",
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </main>
  );
}