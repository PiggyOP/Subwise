import React, { useEffect, useState } from "react";
import { Landmark, CheckCircle2 } from "lucide-react";
const money = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Math.abs(n) / 100,
  );
export default function DemoBank({ api, refresh, notify }) {
  const [number, setNumber] = useState("9000000000"),
    [code, setCode] = useState(""),
    [state, setState] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(0);
  useEffect(() => {
    api("/demo-bank")
      .then(setState)
      .catch((e) => setError(e.message));
  }, []);
  async function connect(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api("/demo-bank/connect", { number, code });
      setState(next);
      setSelected(
        next.accounts.findIndex((a) =>
          a.statement.account.endsWith(number.slice(-4)),
        ),
      );
      await refresh();
      notify("Demo bank processed. Only synthetic data was added.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const account = state?.accounts[Math.max(0, selected)];
  const active =
    account?.subscriptions.filter((s) => s.status !== "cancelled") || [];
  const seen = new Set();
  const rows =
    account?.statement.transactions
      .map((t) => {
        const duplicate = seen.has(t.id);
        seen.add(t.id);
        return { ...t, duplicate };
      })
      .sort((a, b) => b.date.localeCompare(a.date)) || [];
  return (
    <section
      className="panel accountcard demo-bank"
      aria-label="Subwise demo bank"
    >
      <div className="sectiontitle">
        <Landmark size={27} />
        <span className="status needs_review">DEMO BANK · SYNTHETIC DATA</span>
      </div>
      <h2>Test without your phone</h2>
      <p>
        A simulated bank statement with subscriptions, everyday purchases,
        credits and duplicate records. No real bank is contacted and no SMS is
        sent.
      </p>
      <form onSubmit={connect} className="demo-bank-form">
        <label htmlFor="demo-number">Test number</label>
        <select
          id="demo-number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        >
          <option value="9000000000">
            9000000000 — Mixed payments & subscriptions
          </option>
          <option value="9000000001">
            9000000001 — Everyday payments only
          </option>
        </select>
        <label htmlFor="demo-code">Test code</label>
        <input
          id="demo-code"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          pattern="123456"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="Enter 123456"
        />
        <small className="muted">
          Use <b>123456</b> for either test number. This is a public demo code,
          not an SMS OTP or account password.
        </small>
        <button className="primary wide" disabled={busy}>
          {busy ? "Reading demo statement…" : "Connect demo bank"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {account && (
        <div className="demo-bank-results">
          <div className="sectiontitle">
            <CheckCircle2 size={20} />
            <h3>Demo statement processed</h3>
          </div>
          {state.accounts.length > 1 && (
            <label>
              View demo account
              <select
                aria-label="View demo account"
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {state.accounts.map((a, i) => (
                  <option key={a.id} value={i}>
                    {a.statement.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p>
            <b>{account.statement.account}</b> · {rows.length} statement records
            · <b>{active.length} subscriptions found</b>
          </p>
          <p className="muted">
            Four monthly patterns can be inferred in the mixed account. Its
            annual plan is identified from a simulated autopay record; one
            payment alone is not enough to infer annual recurrence.
          </p>
          <h3>What Subwise selected</h3>
          {active.length ? (
            <ul className="demo-findings">
              {active.map((s) => (
                <li key={s.merchant_key}>
                  <b>{s.name}</b>
                  <span>
                    {money(s.amount)} /{" "}
                    {s.cadence === "yearly" ? "year" : "month"}
                  </span>
                  <small>
                    {s.confidence === 1
                      ? "Simulated autopay record"
                      : "Repeated statement payments"}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No subscriptions detected. Ordinary purchases and salary credits
              are not added as subscriptions.
            </p>
          )}
          <details open>
            <summary>View synthetic bank statement</summary>
            <p className="muted">
              Every row below is fictional. Credits and repeated provider IDs
              are ignored by the scanner.
            </p>
            <div className="tablewrap">
              <table aria-label="Synthetic bank statement">
                <thead>
                  <tr>
                    <th>DATE</th>
                    <th>DESCRIPTION</th>
                    <th>METHOD</th>
                    <th>AMOUNT</th>
                    <th>RECORD</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, i) => (
                    <tr key={i}>
                      <td>{t.date}</td>
                      <td>{t.merchant}</td>
                      <td>{t.method}</td>
                      <td>
                        {t.direction === "CREDIT" ? "+" : "−"}
                        {money(t.amount)}
                      </td>
                      <td>
                        {t.duplicate
                          ? "Duplicate · ignored"
                          : t.direction === "CREDIT"
                            ? "Credit · ignored"
                            : "Debit"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>View simulated autopay records</summary>
            {account.statement.mandates.length ? (
              <ul className="demo-findings">
                {account.statement.mandates.map((m) => (
                  <li key={m.id}>
                    <b>{m.merchant}</b>
                    <span>
                      {money(m.amount)} · {m.cadence}
                    </span>
                    <small>
                      {m.status === "cancelled"
                        ? "Cancelled · excluded from active subscriptions"
                        : "Active · next payment " + m.nextDate}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No autopay records in this account.</p>
            )}
            <p className="muted">
              These are demonstration records, not real UPI mandates. They
              cannot cancel or charge anything.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
