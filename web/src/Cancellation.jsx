import React, { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  LoaderCircle,
  ArrowRight,
} from "lucide-react";
const labels = {
  queued: "Cancellation queued",
  processing: "Sending cancellation",
  submitted: "Waiting for provider confirmation",
  unknown: "Checking cancellation status",
  scheduled: "Renewal cancelled",
  cancelled: "Cancellation confirmed",
  failed: "Cancellation not completed",
};
export default function Cancellation({
  subscription,
  demo,
  api,
  refresh,
  notify,
}) {
  const [version, setVersion] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const capability = subscription.cancellation,
    job = capability?.job;
  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        "/subscriptions/" + subscription.id + "/cancel",
        { confirm: true, capabilityVersion: version },
      );
      setVersion(null);
      await refresh();
      notify(
        result.job.status === "cancelled"
          ? "Cancellation confirmed by the provider."
          : "Cancellation requested. Subwise will track provider confirmation.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cancellation-panel" aria-label="Automatic cancellation">
      {job ? (
        <>
          <div className={"cancellation-state " + job.status} role="status">
            {["cancelled", "scheduled"].includes(job.status) ? (
              <CheckCircle2 size={20} />
            ) : (
              <ShieldCheck size={20} />
            )}
            <div>
              <b>{labels[job.status] || "Cancellation status"}</b>
              <p>
                {job.status === "scheduled"
                  ? "Renewal is stopped. Your subscription ends on " +
                    new Date(job.effectiveAt).toLocaleDateString("en-IN") +
                    "."
                  : job.status === "cancelled"
                    ? "The provider has confirmed this subscription is cancelled."
                    : job.status === "failed"
                      ? job.error ||
                        "The provider could not complete this request."
                      : "Subwise is handling this request. Your subscription stays tracked until confirmation arrives."}
              </p>
            </div>
          </div>
          {job.confirmation && (
            <div className="cancellation-receipt">
              <span>Confirmation reference</span>
              <b>{job.confirmation}</b>
            </div>
          )}
        </>
      ) : capability?.available && !demo ? (
        <>
          <div className="cancellation-state">
            <ShieldCheck size={20} />
            <div>
              <b>Cancel directly with Subwise</b>
              <p>
                We send the cancellation to your connected provider and track
                its confirmation.
              </p>
            </div>
          </div>
          {version ? (
            <div className="cancellation-confirm">
              <p>
                Stop renewal of <b>{subscription.name}</b> at the end of the
                current paid period? No refund is requested.
              </p>
              <button className="primary wide" disabled={busy} onClick={cancel}>
                {busy ? (
                  <>
                    <LoaderCircle size={16} className="cancellation-spinner" />{" "}
                    Sending request…
                  </>
                ) : (
                  "Confirm automatic cancellation"
                )}
              </button>
              <button
                className="textbutton wide"
                disabled={busy}
                onClick={() => setVersion(null)}
              >
                Keep subscription
              </button>
            </div>
          ) : (
            <button
              className="primary wide"
              onClick={() => setVersion(capability.version)}
            >
              Cancel automatically <ArrowRight size={16} />
            </button>
          )}
        </>
      ) : (
        <div className="cancellation-state unavailable">
          <ShieldCheck size={20} />
          <div>
            <b>Automatic cancellation unavailable</b>
            <p>
              {demo
                ? "Sample subscriptions cannot be cancelled."
                : "This service needs a merchant-authorized cancellation connection. Bank transaction access alone cannot cancel it."}
            </p>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
