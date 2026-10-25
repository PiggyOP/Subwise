import React, { useEffect, useState } from "react";
import {
  UserRound,
  Mail,
  ShieldCheck,
  CalendarDays,
  CheckCircle2,
  Send,
} from "lucide-react";
export default function Profile({ api, user, demo, notify, onUpdated }) {
  const [profile, setProfile] = useState(null),
    [name, setName] = useState(user.name),
    [email, setEmail] = useState(user.email),
    [enabled, setEnabled] = useState(false),
    [day, setDay] = useState(1),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (demo) {
      setProfile({
        ...user,
        emailVerified: false,
        monthlyEnabled: false,
        monthlyDay: 1,
        deliveryConfigured: false,
        timeZone: "Asia/Kolkata",
        sendTime: "09:00",
      });
      return;
    }
    api("/profile")
      .then((p) => {
        if (!live) return;
        setProfile(p);
        setName(p.name);
        setEmail(p.pendingEmail || p.email);
        setEnabled(p.monthlyEnabled);
        setDay(p.monthlyDay);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [user.id, demo]);
  async function action(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!profile)
    return (
      <section className="panel profile-card">
        <p role="status">{error || "Loading your profile…"}</p>
      </section>
    );
  const verified = profile.emailVerified && email === profile.email;
  return (
    <div className="profile-grid">
      <section className="panel profile-card">
        <div className="profile-identity">
          <span className="profile-avatar">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h2>Your profile</h2>
            <p>Your account details are saved securely on the backend.</p>
          </div>
        </div>
        {demo && (
          <div className="notice">
            <p>
              Sample profile · Sign in to save your details and email
              preferences.
            </p>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              const p = await api(
                "/profile",
                { name, monthlyEnabled: enabled, monthlyDay: Number(day) },
                "PATCH",
              );
              setProfile(p);
              onUpdated({ name: p.name, email: p.email });
              notify("Profile and monthly email preferences saved.");
            });
          }}
        >
          <label>
            Full name
            <input
              name="name"
              autoComplete="name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="profile-section">
            <h3>
              <Mail size={18} />
              Linked email address
            </h3>
            <p>
              This is your sign-in address and the destination for monthly
              subscription emails.
            </p>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <span
              className={
                "status " + (verified ? "active" : "cancellation_requested")
              }
            >
              <i />
              {verified ? "Verified email" : "Verification required"}
            </span>
            {email !== profile.email && (
              <label>
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Required to change your sign-in email"
                />
              </label>
            )}
            <button
              type="button"
              className="secondary wide"
              disabled={demo || busy || !profile.deliveryConfigured || verified}
              onClick={() =>
                action(async () => {
                  const r = await api("/profile/email/request", {
                    email,
                    currentPassword: password,
                  });
                  setProfile(await api("/profile"));
                  notify(r.message);
                })
              }
            >
              {verified ? (
                <>
                  <ShieldCheck size={16} />
                  Email verified
                </>
              ) : (
                <>
                  <Send size={16} />
                  Send verification code
                </>
              )}
            </button>
            {profile.pendingEmail && (
              <div className="verification-box">
                <p>
                  Enter the six-digit code sent to {profile.pendingEmail}. It
                  expires in 10 minutes.
                </p>
                <label>
                  Verification code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <button
                  type="button"
                  className="primary wide"
                  disabled={busy || code.length !== 6 || demo}
                  onClick={() =>
                    action(async () => {
                      const p = await api("/profile/email/verify", { code });
                      setProfile(p);
                      setEmail(p.email);
                      setPassword("");
                      setCode("");
                      onUpdated({ name: p.name, email: p.email });
                      notify("Email verified and linked to your account.");
                    })
                  }
                >
                  Verify & link email <CheckCircle2 size={16} />
                </button>
              </div>
            )}
          </div>
          <div className="profile-section">
            <h3>
              <CalendarDays size={18} />
              Monthly subscription emails
            </h3>
            <p>
              A summary of your tracked subscriptions, monthly commitment, and
              upcoming recorded renewals.
            </p>
            <label className="email-optin">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>Email me a monthly subscription summary</span>
            </label>
            <label>
              Send each month on
              <select
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              >
                {Array.from({ length: 28 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Day {i + 1} · 9:00 a.m. India time
                  </option>
                ))}
              </select>
            </label>
            <p className="profile-fine">
              Monthly emails start after you verify your address. You can turn
              them off here or unsubscribe from any summary.
            </p>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={demo || busy}>
            {busy ? "Saving…" : "Save profile & preferences"}
            <CheckCircle2 size={16} />
          </button>
        </form>
      </section>
      <aside className="profile-details">
        <section className="panel profile-card">
          <Mail size={25} />
          <h2>Email delivery</h2>
          <span
            className={
              "status " +
              (profile.deliveryConfigured ? "active" : "cancellation_requested")
            }
          >
            <i />
            {profile.deliveryConfigured
              ? "Email provider configured"
              : "Email provider not configured"}
          </span>
          <p>
            {profile.deliveryConfigured
              ? "Verified, opted-in customers can receive monthly summaries automatically."
              : "Your email and preferences can be saved now. The operator must configure an email provider and verified sender domain before any messages can be sent."}
          </p>
          <dl>
            <div>
              <dt>Monthly summaries</dt>
              <dd>{profile.monthlyEnabled ? "Opted in" : "Off"}</dd>
            </div>
            <div>
              <dt>Email verification</dt>
              <dd>{profile.emailVerified ? "Verified" : "Pending"}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>Day {profile.monthlyDay}, 9:00 a.m. IST</dd>
            </div>
            <div>
              <dt>Next scheduled</dt>
              <dd>
                {profile.monthlyEnabled &&
                profile.emailVerified &&
                profile.nextSendAt
                  ? new Date(profile.nextSendAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      dateStyle: "medium",
                      timeStyle: "short",
                    }) + " IST"
                  : "Verify and opt in first"}
              </dd>
            </div>
            <div>
              <dt>Last email</dt>
              <dd>
                {profile.lastEmail
                  ? profile.lastEmail.status === "accepted"
                    ? "Accepted by provider"
                    : profile.lastEmail.status
                  : "No email sent"}
              </dd>
            </div>
          </dl>
          <button
            className="secondary wide"
            disabled={
              demo ||
              busy ||
              !profile.deliveryConfigured ||
              !profile.emailVerified
            }
            onClick={() =>
              action(async () => {
                const r = await api("/profile/email/test", {});
                setProfile(await api("/profile"));
                notify(r.message);
              })
            }
          >
            Send test summary <Send size={16} />
          </button>
        </section>
        <section className="panel profile-card">
          <ShieldCheck size={25} />
          <h2>Your choice, every month.</h2>
          <p>
            Only verified email addresses receive summaries. Monthly emails are
            optional, and changing your email requires verification.
          </p>
          <p className="profile-fine">
            Provider acceptance does not guarantee inbox delivery. Delivery
            failures are recorded for review.
          </p>
        </section>
      </aside>
    </div>
  );
}
