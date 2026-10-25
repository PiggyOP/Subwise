import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useTheme } from "./theme";
const labels = {
  queued: "Cancellation queued",
  processing: "Sending cancellation",
  submitted: "Waiting for provider confirmation",
  unknown: "Checking cancellation status",
  scheduled: "Renewal cancelled",
  cancelled: "Cancellation confirmed",
  failed: "Cancellation not completed",
};
export default function Cancellation({ subscription, api, refresh }) {
  const { theme } = useTheme(),
    dark = theme === "dark",
    text = { color: dark ? "#d7e3ce" : "#334b3c" };
  const [version, setVersion] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const cap = subscription.cancellation,
    job = cap?.job;
  const button = (label, onPress, secondary = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={[
        s.button,
        {
          backgroundColor: secondary ? "transparent" : "#174b3a",
          opacity: busy ? 0.6 : 1,
        },
      ]}
    >
      {busy && !secondary ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={secondary ? text : s.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
  return (
    <View style={s.panel}>
      {job ? (
        <>
          <Text accessibilityLiveRegion="polite" style={[s.title, text]}>
            {labels[job.status] || "Cancellation status"}
          </Text>
          <Text style={[s.copy, text]}>
            {job.status === "scheduled"
              ? "Renewal is stopped. Your subscription ends on " +
                new Date(job.effectiveAt).toLocaleDateString("en-IN") +
                "."
              : job.status === "cancelled"
                ? "The provider confirmed cancellation."
                : job.status === "failed"
                  ? job.error || "The provider could not complete this request."
                  : "Subwise is handling this request and tracking provider confirmation."}
          </Text>
          {!!job.confirmation && (
            <Text style={[s.copy, text]}>
              Confirmation reference: {job.confirmation}
            </Text>
          )}
        </>
      ) : cap?.available ? (
        <>
          <Text style={[s.title, text]}>Cancel directly with Subwise</Text>
          <Text style={[s.copy, text]}>
            We send the cancellation and track provider confirmation.
          </Text>
          {version ? (
            <>
              <Text style={[s.copy, text]}>
                Stop renewal of {subscription.name} at the end of the current
                paid period? No refund is requested.
              </Text>
              {button("Confirm automatic cancellation", async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/subscriptions/" + subscription.id + "/cancel", {
                    confirm: true,
                    capabilityVersion: version,
                  });
                  setVersion(null);
                  await refresh();
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              })}
              {button("Keep subscription", () => setVersion(null), true)}
            </>
          ) : (
            button("Cancel automatically", () => setVersion(cap.version))
          )}
        </>
      ) : (
        <>
          <Text style={[s.title, text]}>
            Automatic cancellation unavailable
          </Text>
          <Text style={[s.copy, text]}>
            This service needs a merchant-authorized cancellation connection.
            Bank transaction access alone cannot cancel it.
          </Text>
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={[s.copy, text]}>
          {error}
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  panel: {
    marginVertical: 20,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#81947a55",
  },
  title: { fontSize: 16, fontWeight: "500", lineHeight: 24 },
  copy: { fontSize: 13, lineHeight: 22, marginTop: 10 },
  button: {
    minHeight: 48,
    padding: 14,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  buttonText: { fontSize: 14, color: "#fff", textAlign: "center" },
});
