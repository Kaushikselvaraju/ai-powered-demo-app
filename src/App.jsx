import { useMemo, useState } from "react";
import "./App.css";

function Section({ title, children }) {
    return (
        <section className="section">
            <h2 className="sectionTitle">{title}</h2>
            <div className="sectionBody">{children}</div>
        </section>
    );
}

export default function App() {
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [messageKind, setMessageKind] = useState("info");
    const [result, setResult] = useState(null);

    const rawJson = useMemo(() => {
        if (!result) return "";
        return JSON.stringify(result, null, 2);
    }, [result]);

    async function onGenerate() {
        setMessage("");
        setMessageKind("info");

        const trimmed = input.trim();
        if (!trimmed) {
            setMessageKind("info");
            setMessage("Type a workflow problem above, then click Generate Plan.");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch("/.netlify/functions/generatePlan", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ input: trimmed })
            });

            const text = await res.text();
            const json = (() => {
                try {
                    return text ? JSON.parse(text) : null;
                } catch {
                    return null;
                }
            })();

            if (!res.ok) {
                const errMsg = json?.error || `Request failed (${res.status})`;
                const requestId = json?.requestId ? ` (requestId: ${json.requestId})` : "";
                throw new Error(errMsg + requestId);
            }

            if (!json || typeof json !== "object") {
                throw new Error("Server returned an unexpected response.");
            }

            setResult(json);
        } catch (err) {
            setMessageKind("error");
            setMessage(err?.message || "Something went wrong.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="page">
            <div className="container">
                <header className="header">
                    <h1 className="title">AI Office Hours Helper</h1>
                    <p className="subtitle">Paste a workflow problem and get a structured plan.</p>
                </header>

                <div className="card">
                    <label className="label" htmlFor="problem">
                        Workflow problem
                    </label>
                    <textarea
                        id="problem"
                        className="textarea"
                        rows={6}
                        placeholder="Example: Our team triages hundreds of Jira tickets manually each week..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={loading}
                    />

                    <div className="actions">
                        <button className="button" onClick={onGenerate} disabled={loading}>
                            {loading ? "Generating…" : "Generate Plan"}
                        </button>
                        {message ? (
                            <div className={messageKind === "error" ? "message messageError" : "message"}>
                                {message}
                            </div>
                        ) : null}
                    </div>
                </div>

                {loading ? (
                    <div className="loading">Working on it…</div>
                ) : null}

                {result ? (
                    <div className="grid">
                        <div className="card">
                            <h2 className="cardTitle">Human readable</h2>

                            <Section title="Problem Statement">
                                <p className="paragraph">{result.problem_statement}</p>
                            </Section>

                            <Section title="Clarifying Questions">
                                <ul className="bullets">
                                    {result.clarifying_questions?.map((q, idx) => (
                                        <li key={idx}>{q}</li>
                                    ))}
                                </ul>
                            </Section>

                            <Section title="Proposed Approach">
                                <ul className="bullets">
                                    {result.proposed_approach?.map((step, idx) => (
                                        <li key={idx}>{step}</li>
                                    ))}
                                </ul>
                            </Section>

                            <Section title="Recommended Tools">
                                <div className="tags">
                                    {result.recommended_tools?.map((t, idx) => (
                                        <span className="tag" key={idx}>
                                            {t}
                                        </span>
                                    ))}
                                </div>
                            </Section>

                            <Section title="Risks & Privacy">
                                <ul className="bullets">
                                    {result.risks_and_privacy?.map((r, idx) => (
                                        <li key={idx}>{r}</li>
                                    ))}
                                </ul>
                            </Section>

                            <Section title="Next Steps">
                                <ul className="checklist">
                                    {result.next_steps?.map((s, idx) => (
                                        <li className="checkItem" key={idx}>
                                            <input type="checkbox" disabled />
                                            <span>{s}</span>
                                        </li>
                                    ))}
                                </ul>
                            </Section>
                        </div>

                        <div className="card">
                            <h2 className="cardTitle">Raw JSON</h2>
                            <pre className="pre">{rawJson}</pre>
                        </div>
                    </div>
                ) : null}

                <footer className="footer">
                    <span className="hint">
                        Calls <code>POST /.netlify/functions/generatePlan</code> with
                        <code>{` { input: string }`}</code>.
                    </span>
                </footer>
            </div>
        </div>
    );
}
