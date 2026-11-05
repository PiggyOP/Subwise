import React, { useEffect, useState } from "react";
import { Landmark, ArrowUpRight, RefreshCw, ExternalLink } from "lucide-react";

export default function SetuSandbox({ api, refresh, notify }) {
  const [connections, setConnections] = useState([]),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState("9999999999"),
    [error, setError] = useState("");
  const load = () =>
    api("/setu/connections")
      .then(setConnections)
      .catch((e) => notify(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!connections.some((c) => ["pending", "connected"].includes(c.status)))
      return;
    const sync = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        await api("/setu/sync", {});
        await load();
        await refresh();
      } catch (e) {
        notify(e.message);
      }
    };
    sync();
    const timer = setInterval(sync, 60000);
    return () => clearInterval(timer);
  }, [connections.map((c) => c.id + c.status).join(",")]);
  async function connect() {
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setError(
        "Enter a 10-digit mobile number registered for sandbox testing.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api("/setu/connections", { mobile });
      window.location.assign(result.authorizationUrl);
    } catch (e) {
      setError(e.message);
      notify(e.message);
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    try {
      await api("/setu/sync", {});
      await load();
      await refresh();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const connected = connections.some((c) => c.status === "connected");
  return (
    <section
      className="panel accountcard setu-sandbox"
      aria-label="Setu bank sandbox"
    >
      <div className="sectiontitle">
        <Landmark size={27} />
        <span className="status needs_review">SANDBOX · TEST DATA</span>
      </div>
      <h2>Connect a test bank</h2>
      <p>
        Try Setu’s bank consent journey with sample accounts. Only this test
        account can access the sandbox. These records are not your real
        spending.
      </p>
      <p className="muted">
        Bank history may include UPI and debit-card payments. This connection
        does not provide credit-card purchase feeds, UPI mandates, or
        cancellation access.
      </p>
      {connections.map((c) => (
        <div key={c.id} className="setu-connection">
          <div className="sectiontitle">
            <b>Setu test bank</b>
            <span
              className={
                "status " +
                (c.status === "connected" ? "active" : "needs_review")
              }
            >
              {c.status}
            </span>
          </div>
          <small className="muted">
            {c.last_sync
              ? "Last checked " + new Date(c.last_sync).toLocaleString()
              : "Waiting for approved consent and sample transactions"}
          </small>
          {c.last_error && <p role="status">{c.last_error}</p>}
          {c.status === "pending" && (
            <a className="textbutton" href={c.authorization_url}>
              Continue consent <ExternalLink size={14} />
            </a>
          )}
        </div>
      ))}
      {!connected && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <label htmlFor="setu-mobile">Sandbox mobile number</label>
          <input
            id="setu-mobile"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={10}
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
            placeholder="10-digit sandbox-registered number"
            required
            pattern="[6-9][0-9]{9}"
          />
          <small className="muted">
            Uses Setu’s Finvu test flow. Login OTP: 111111. Consent OTP: 123456.
            Enter these only on the provider’s test screen. Select Setu FIP-2
            for sample bank data; its linking OTP is 123456. Choose a normal
            sample account, not one labelled FAILURE.
          </small>
          <button type="submit" className="primary wide" disabled={busy}>
            {busy ? "Connecting…" : "Connect Setu test bank"}
            <ArrowUpRight size={16} />
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {connections.length > 0 && (
        <button className="secondary wide" disabled={busy} onClick={sync}>
          <RefreshCw size={16} />
          {busy ? "Checking…" : "Refresh sandbox data"}
        </button>
      )}
      <small className="muted">
        Up to 89 days of sample history. Recurrence is shown only when enough
        matching payments exist. Sandbox financial records expire within 28
        days.
      </small>
    </section>
  );
}
