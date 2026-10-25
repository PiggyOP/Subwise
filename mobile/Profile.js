import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  StyleSheet,
  Alert,
} from "react-native";
import { useTheme } from "./theme";
export default function Profile({ api, user, onUpdated }) {
  const { theme } = useTheme(),
    dark = theme === "dark",
    s = dark ? darkStyles : styles;
  const [profile, setProfile] = useState(null),
    [name, setName] = useState(user.name),
    [email, setEmail] = useState(user.email),
    [enabled, setEnabled] = useState(false),
    [day, setDay] = useState("1"),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api("/profile")
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        setName(p.name);
        setEmail(p.pendingEmail || p.email);
        setEnabled(p.monthlyEnabled);
        setDay(String(p.monthlyDay));
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [user.id]);
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
  const button = (title, fn, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={() => action(fn)}
      style={[s.button, (busy || disabled) && { opacity: 0.45 }]}
    >
      <Text style={s.buttonText}>{title}</Text>
    </Pressable>
  );
  if (!profile)
    return <Text style={s.body}>{error || "Loading your profile…"}</Text>;
  const verified = profile.emailVerified && email === profile.email;
  return (
    <View>
      <View style={s.identity}>
        <View style={s.avatar}>
          <Text style={s.initial}>{name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Your profile</Text>
          <Text style={s.body}>
            Your details and monthly email preferences.
          </Text>
        </View>
      </View>
      <Text style={s.label}>Full name</Text>
      <TextInput
        accessibilityLabel="Full name"
        autoComplete="name"
        maxLength={80}
        style={s.input}
        value={name}
        onChangeText={setName}
      />
      <View style={s.section}>
        <Text style={s.subtitle}>Linked email address</Text>
        <Text style={s.body}>
          Your sign-in address and monthly summary destination.
        </Text>
        <Text style={s.label}>Email address</Text>
        <TextInput
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          style={s.input}
          value={email}
          onChangeText={setEmail}
        />
        <Text style={s.note}>
          {verified ? "✓ Verified email" : "Verification required"}
        </Text>
        {email !== profile.email && (
          <>
            <Text style={s.label}>Current password</Text>
            <TextInput
              accessibilityLabel="Current password"
              secureTextEntry
              autoComplete="current-password"
              style={s.input}
              value={password}
              onChangeText={setPassword}
            />
          </>
        )}
        {button(
          verified ? "Email verified" : "Send verification code",
          async () => {
            const r = await api("/profile/email/request", {
              email,
              currentPassword: password,
            });
            setProfile(await api("/profile"));
            Alert.alert("Verification", r.message);
          },
          !profile.deliveryConfigured || verified,
        )}
        {profile.pendingEmail && (
          <>
            <Text style={s.body}>
              Enter the six-digit code sent to {profile.pendingEmail}. It
              expires in 10 minutes.
            </Text>
            <Text style={s.label}>Verification code</Text>
            <TextInput
              accessibilityLabel="Verification code"
              autoComplete="one-time-code"
              keyboardType="number-pad"
              maxLength={6}
              style={s.input}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, ""))}
            />
            {button(
              "Verify & link email",
              async () => {
                const p = await api("/profile/email/verify", { code });
                setProfile(p);
                setEmail(p.email);
                setCode("");
                setPassword("");
                onUpdated({ name: p.name, email: p.email });
              },
              code.length !== 6,
            )}
          </>
        )}
      </View>
      <View style={s.section}>
        <Text style={s.subtitle}>Monthly subscription emails</Text>
        <View style={s.optin}>
          <Switch
            accessibilityLabel="Email me a monthly subscription summary"
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ true: "#7d9c6a" }}
          />
          <Text style={[s.body, { flex: 1 }]}>
            Email me a monthly subscription summary
          </Text>
        </View>
        <Text style={s.label}>Day of month (1–28)</Text>
        <TextInput
          accessibilityLabel="Day of month"
          keyboardType="number-pad"
          maxLength={2}
          style={s.input}
          value={day}
          onChangeText={setDay}
        />
        <Text style={s.note}>
          9:00 a.m. India time · Verify your email before monthly sending
          starts.
        </Text>
      </View>
      {error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {button(busy ? "Saving…" : "Save profile & preferences", async () => {
        const p = await api(
          "/profile",
          { name, monthlyEnabled: enabled, monthlyDay: Number(day) },
          "PATCH",
        );
        setProfile(p);
        onUpdated({ name: p.name, email: p.email });
        Alert.alert("Saved", "Profile and monthly email preferences saved.");
      })}
      <View style={s.section}>
        <Text style={s.subtitle}>Email delivery</Text>
        <Text style={s.body}>
          {profile.deliveryConfigured
            ? "Email provider configured. Summaries send to verified, opted-in addresses."
            : "Email provider not configured. Your email and preferences can be saved now; real delivery needs a verified sender domain and provider key."}
        </Text>
        <Text style={s.note}>
          {profile.monthlyEnabled && profile.emailVerified && profile.nextSendAt
            ? "Next scheduled: " +
              new Date(profile.nextSendAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              }) +
              " IST"
            : "Monthly summaries start after verification and opt-in."}
        </Text>
        {button(
          "Send test summary",
          async () => {
            const r = await api("/profile/email/test", {});
            setProfile(await api("/profile"));
            Alert.alert("Test summary", r.message);
          },
          !profile.deliveryConfigured || !profile.emailVerified,
        )}
        <Text style={s.note}>
          You can unsubscribe from any monthly summary. Provider acceptance does
          not guarantee inbox delivery.
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 22,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#e5ebdf",
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontSize: 20, color: "#3d643a" },
  title: { fontSize: 22, fontWeight: "500", color: "#263c32" },
  subtitle: { fontSize: 16, fontWeight: "500", color: "#354735" },
  body: { fontSize: 13, lineHeight: 22, color: "#6f786c", marginTop: 8 },
  label: { fontSize: 12, color: "#5d7350", marginTop: 18, marginBottom: 9 },
  input: {
    borderWidth: 1,
    borderColor: "#cddbc1",
    borderRadius: 4,
    padding: 13,
    fontSize: 14,
    color: "#385b2a",
    backgroundColor: "#fff",
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: "#dfe4df",
    paddingTop: 23,
    marginTop: 25,
  },
  button: {
    backgroundColor: "#174b3a",
    borderRadius: 5,
    padding: 14,
    alignItems: "center",
    marginTop: 15,
  },
  buttonText: { color: "#fff", fontSize: 13, fontWeight: "500" },
  note: { fontSize: 11, lineHeight: 19, color: "#7e8b73", marginTop: 12 },
  optin: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  error: {
    fontSize: 12,
    lineHeight: 19,
    color: "#aa6753",
    padding: 12,
    backgroundColor: "#faf0e9",
    borderRadius: 4,
    marginTop: 12,
  },
});
const palette = {
  "#263c32": "#e4ecdc",
  "#354735": "#dce9cf",
  "#6f786c": "#a0af92",
  "#e5ebdf": "#30432b",
  "#3d643a": "#c1d5b3",
  "#5d7350": "#b1cb96",
  "#cddbc1": "#3f5b2f",
  "#385b2a": "#dceace",
  "#fff": "#19251d",
  "#dfe4df": "#2e3e2c",
  "#174b3a": "#315e3d",
  "#7e8b73": "#a3b78f",
  "#aa6753": "#e8bba0",
  "#faf0e9": "#3a2b1d",
};
const darkValues = Object.fromEntries(
  Object.entries(styles).map(([key, value]) => [
    key,
    Object.fromEntries(
      Object.entries(value).map(([property, current]) => [
        property,
        palette[current] || current,
      ]),
    ),
  ]),
);
const darkStyles = StyleSheet.create({
  ...darkValues,
  buttonText: { ...styles.buttonText, color: "#f0f4e7" },
});
