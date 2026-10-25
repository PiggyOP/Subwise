import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Animated,
  AccessibilityInfo,
  Easing,
  Linking,
  Switch,
  Platform,
  AppState,
  Image,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { brandLogos } from "./brand-logos";
import Profile from "./Profile";
import Cancellation from "./Cancellation";
import { ThemeProvider, ThemeToggle, useTheme } from "./theme";

const BASE = (process.env.EXPO_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
const currency = (n) => "₹" + Math.round(n / 100).toLocaleString("en-IN");
const shortDate = (s) =>
  new Date(s + "T12:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
const colors = ["#174e3f", "#9fbb86", "#cbdca6", "#d6bf92", "#95adb9"];
const Button = ({ title, onPress, secondary, disabled }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark",
    styles = isDark ? darkStyles : lightStyles;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary && { color: isDark ? "#c8dbbf" : "#365d43" },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
};
const Field = ({ label, value, onChangeText, ...props }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark",
    styles = isDark ? darkStyles : lightStyles;
  return (
    <View style={{ marginBottom: 15 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={isDark ? "#8fa38b" : "#a6b29e"}
        {...props}
      />
    </View>
  );
};
export default function ThemedApp() {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}
function App() {
  const { theme } = useTheme();
  const isDark = theme === "dark",
    styles = isDark ? darkStyles : lightStyles;
  const [token, setToken] = useState(null),
    [user, setUser] = useState(null),
    [data, setData] = useState(null),
    [catalog, setCatalog] = useState([]),
    [tab, setTab] = useState("Home"),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [modal, setModal] = useState(null),
    [selected, setSelected] = useState(null),
    [register, setRegister] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [aiText, setAiText] = useState(""),
    [aiConsent, setAiConsent] = useState(false),
    [messages, setMessages] = useState([]),
    [busy, setBusy] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  async function api(path, body, method, override) {
    if (!BASE)
      throw Error(
        "Set EXPO_PUBLIC_API_URL to your HTTPS Subwise backend before signing in.",
      );
    if (!__DEV__ && !BASE.startsWith("https://"))
      throw Error("A secure HTTPS backend is required.");
    const r = await fetch(BASE + "/api" + path, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        "x-client": "mobile",
        ...(override || token
          ? { Authorization: "Bearer " + (override || token) }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await r
      .json()
      .catch(() => ({ error: "Server unavailable" }));
    if (!r.ok) {
      if (r.status === 401 && token) {
        await SecureStore.deleteItemAsync("subwise.session");
        setToken(null);
        setUser(null);
      }
      throw Error(result.error || "Could not complete request");
    }
    return result;
  }
  async function refresh(t) {
    const [u, d, c] = await Promise.all([
      api("/me", null, null, t),
      api("/dashboard", null, null, t),
      api("/catalog", null, null, t),
    ]);
    setUser(u);
    setData(d);
    setCatalog(c);
  }
  useEffect(() => {
    (async () => {
      try {
        const t = await SecureStore.getItemAsync("subwise.session");
        if (t) {
          setToken(t);
          await refresh(t);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const reveal = (reduced) => {
      if (cancelled) return;
      fade.stopAnimation();
      fade.setValue(reduced ? 1 : 0);
      if (!reduced)
        Animated.timing(fade, {
          toValue: 1,
          duration: 480,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reveal)
      .catch(() => reveal(true));
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      reveal,
    );
    return () => {
      cancelled = true;
      listener.remove();
      fade.stopAnimation();
    };
  }, [tab, token]);
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") refresh().catch(() => {});
    }, 30000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh().catch(() => {});
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [token]);
  async function authenticate() {
    setBusy(true);
    setError("");
    try {
      const r = await api("/auth/" + (register ? "register" : "login"), {
        email,
        password,
        ...(register ? { name } : {}),
      });
      await SecureStore.setItemAsync("subwise.session", r.token);
      setToken(r.token);
      await refresh(r.token);
      setPassword("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (selected && data) {
      const current = data.subscriptions.find((s) => s.id === selected.id);
      if (current) setSelected(current);
    }
  }, [data]);
  async function change(s, status) {
    try {
      await api("/subscriptions/" + s.id, { status }, "PATCH");
      await refresh();
      setModal(null);
    } catch (e) {
      Alert.alert("Unable to update", e.message);
    }
  }

  const subs = data?.subscriptions || [],
    active = subs.filter((s) =>
      ["active", "cancellation_requested"].includes(s.status),
    ),
    monthly = active.reduce(
      (s, x) =>
        s +
        x.amount *
          (x.cadence === "yearly"
            ? 1 / 12
            : x.cadence === "weekly"
              ? 52 / 12
              : 1),
      0,
    ),
    categories = [...new Set(active.map((s) => s.category))];
  const item = (s) => (
    <Pressable
      key={s.id}
      accessibilityRole="button"
      accessibilityLabel={"Manage " + s.name}
      style={styles.subscription}
      onPress={() => {
        setSelected(s);
        setModal("manage");
      }}
    >
      <Image
        accessibilityLabel={s.name + " logo"}
        source={
          brandLogos[catalog.find((c) => c.name === s.name)?.id] ||
          brandLogos.unknown
        }
        style={{
          width: 38,
          height: 38,
          borderRadius: 5,
          backgroundColor: "#fafbf7",
        }}
        resizeMode="contain"
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.itemName}>{s.name}</Text>
        <Text style={styles.caption}>
          {shortDate(s.next_date)} · {s.status.replaceAll("_", " ")}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.itemName}>{currency(s.amount)}</Text>
        <Text style={styles.caption}>
          /{" "}
          {s.cadence === "monthly"
            ? "month"
            : s.cadence === "yearly"
              ? "year"
              : "week"}
        </Text>
      </View>
      <Text style={{ color: isDark ? "#a5b79d" : "#94a387", marginLeft: 10 }}>
        ↗
      </Text>
    </Pressable>
  );
  if (loading)
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.center}>
          <ActivityIndicator color="#194e3e" />
          <Text style={styles.caption}>Finding your clarity…</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style={isDark ? "light" : "dark"} />
        {!token ? (
          <Animated.ScrollView
            style={{
              opacity: fade,
              transform: [
                {
                  translateY: fade.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.auth}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={styles.wordmark}>▰ subwise.</Text>
              <ThemeToggle />
            </View>
            <View style={styles.authHero}>
              <Text style={styles.kicker}>LESS AUTOPILOT. MORE LIFE.</Text>
              <Text style={styles.authTitle}>
                Keep the good.{"\n"}Let go of the{"\n"}
                <Text style={{ color: "#bfd58b" }}>forgotten.</Text>
              </Text>
              <Text style={styles.authSubtitle}>
                One calm place for all your subscriptions.
              </Text>
            </View>
            <Text style={styles.title}>
              {register ? "Make room for what matters." : "Welcome back."}
            </Text>
            {register && (
              <Field
                label="Your name"
                value={name}
                onChangeText={setName}
                autoComplete="name"
              />
            )}
            <Field
              label="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Field
              label="Password · at least 12 characters"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={register ? "new-password" : "current-password"}
            />
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            <Button
              title={
                busy
                  ? "One moment…"
                  : register
                    ? "Create account →"
                    : "Sign in →"
              }
              disabled={busy}
              onPress={authenticate}
            />
            <Button
              secondary
              title={
                register
                  ? "Already a member? Sign in"
                  : "New here? Create an account"
              }
              onPress={() => {
                setRegister(!register);
                setError("");
              }}
            />
            <Text style={styles.footnote}>
              Your bank passwords, OTPs, and UPI PINs never belong here.
            </Text>
          </Animated.ScrollView>
        ) : (
          <>
            <View style={styles.topbar}>
              <Text style={styles.wordmark}>▰ subwise.</Text>

              <Pressable
                accessibilityLabel="Open profile"
                onPress={() => setModal("profile")}
                style={styles.avatar}
              >
                <Text
                  style={{
                    color: isDark ? "#c1d5b3" : "#536e42",
                    fontWeight: "700",
                  }}
                >
                  {user?.name?.[0]?.toUpperCase() || "S"}
                </Text>
              </Pressable>
            </View>
            <Animated.View
              style={{
                flex: 1,
                opacity: fade,
                transform: [
                  {
                    translateY: fade.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
              }}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.content}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={async () => {
                      setRefreshing(true);
                      try {
                        await refresh();
                      } catch (e) {
                        Alert.alert("Refresh failed", e.message);
                      } finally {
                        setRefreshing(false);
                      }
                    }}
                  />
                }
              >
                {data?.access === false && (
                  <View style={styles.notice}>
                    <Text style={styles.body}>
                      Your membership is inactive. Paid access is required for
                      subscription features. Review your membership in Settings.
                    </Text>
                  </View>
                )}
                {tab === "Home" && (
                  <>
                    <Text style={styles.kicker}>
                      YOUR MONEY, A LITTLE MORE MINDFUL
                    </Text>
                    <Text style={styles.heading}>
                      A little clarity.{"\n"}A lot more control.
                    </Text>
                    <Text style={styles.subtitle}>
                      Welcome back, {user?.name?.split(" ")[0]}.
                    </Text>
                    <Text style={styles.sectionTitle}>Your subscriptions</Text>
                    <View style={styles.card}>
                      {subs.length ? (
                        subs.map(item)
                      ) : (
                        <Text style={styles.body}>
                          Connect a supported card or UPI account to see your
                          subscriptions.
                        </Text>
                      )}
                    </View>
                    <View style={styles.balance}>
                      <Text style={styles.balanceLabel}>
                        Monthly commitment
                      </Text>
                      <Text style={styles.balanceValue}>
                        {currency(monthly)}
                        <Text style={styles.balanceSmall}> / mo</Text>
                      </Text>
                      <Text style={styles.balanceLabel}>
                        ● {currency(monthly * 12)} projected per year
                      </Text>
                    </View>
                    <View style={styles.row}>
                      <View style={styles.miniCard}>
                        <Text style={styles.caption}>Active subscriptions</Text>
                        <Text style={styles.miniValue}>
                          {active.length.toString().padStart(2, "0")}
                        </Text>
                      </View>
                      <View style={styles.miniCard}>
                        <Text style={styles.caption}>
                          Categories in your life
                        </Text>
                        <Text style={styles.miniValue}>
                          {categories.length.toString().padStart(2, "0")}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.card}>
                      <Text style={styles.sectionTitle}>
                        Your spending, in perspective
                      </Text>
                      {categories.length ? (
                        categories.map((c, i) => {
                          const value = active
                            .filter((x) => x.category === c)
                            .reduce(
                              (a, x) =>
                                a +
                                x.amount *
                                  (x.cadence === "yearly"
                                    ? 1 / 12
                                    : x.cadence === "weekly"
                                      ? 52 / 12
                                      : 1),
                              0,
                            );
                          return (
                            <View key={c} style={{ marginTop: 20 }}>
                              <View style={styles.between}>
                                <Text style={styles.body}>{c}</Text>
                                <Text style={styles.body}>
                                  {currency(value)}
                                </Text>
                              </View>
                              <View style={styles.progressTrack}>
                                <View
                                  style={{
                                    height: 6,
                                    borderRadius: 3,
                                    width: `${(value / monthly) * 100}%`,
                                    backgroundColor: colors[i % colors.length],
                                  }}
                                />
                              </View>
                            </View>
                          );
                        })
                      ) : (
                        <Text style={styles.body}>
                          Add a subscription to build your spending picture.
                        </Text>
                      )}
                    </View>
                    <Pressable
                      style={styles.aiBanner}
                      onPress={() => setModal("ai")}
                    >
                      <Text style={{ fontSize: 30, color: "#6f8b59" }}>✧</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sectionTitle}>
                          Less admin. More peace of mind.
                        </Text>
                        <Text style={styles.caption}>
                          Meet your subscription assistant ↗
                        </Text>
                      </View>
                    </Pressable>
                    <View style={styles.between}>
                      <Text style={styles.sectionTitle}>Coming up next</Text>
                      <Pressable onPress={() => setTab("Subscriptions")}>
                        <Text style={styles.link}>View all →</Text>
                      </Pressable>
                    </View>
                    <View style={styles.card}>
                      {active
                        .filter(
                          (s) =>
                            s.next_date >=
                            new Date().toISOString().slice(0, 10),
                        )
                        .slice(0, 4)
                        .map(item)}
                      {!active.length && (
                        <Text style={styles.body}>
                          Your subscriptions will appear here.
                        </Text>
                      )}
                    </View>
                    <Button
                      secondary
                      title="Connect card or UPI →"
                      onPress={() => setTab("Accounts")}
                    />
                  </>
                )}
                {tab === "Subscriptions" && (
                  <>
                    <Text style={styles.kicker}>EVERYTHING, ACCOUNTED FOR</Text>
                    <Text style={styles.heading}>Your subscriptions.</Text>
                    <TextInput
                      style={styles.input}
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search your subscriptions"
                      placeholderTextColor={isDark ? "#9bad8d" : "#9caa91"}
                    />
                    <View style={styles.card}>
                      {subs
                        .filter((s) =>
                          s.name.toLowerCase().includes(query.toLowerCase()),
                        )
                        .map(item)}
                      {!subs.length && (
                        <Text style={styles.body}>
                          Connect your card or UPI account. Subscriptions appear
                          automatically.
                        </Text>
                      )}
                    </View>
                    <Button
                      secondary
                      title="Connect card or UPI →"
                      onPress={() => setTab("Accounts")}
                    />
                    <Button
                      secondary
                      title="Connect card or UPI →"
                      onPress={() => setTab("Accounts")}
                    />
                  </>
                )}
                {tab === "Discover" && (
                  <>
                    <Text style={styles.kicker}>GOOD THINGS TO EXPLORE</Text>
                    <Text style={styles.heading}>
                      Find your next favourite.
                    </Text>
                    <Text style={styles.body}>
                      Confirm current prices and plans with each provider.
                    </Text>
                    <TextInput
                      accessibilityLabel="Search services"
                      style={styles.input}
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search 120 services"
                    />
                    {catalog
                      .filter((c) =>
                        [c.name, ...c.aliases].some((v) =>
                          v.toLowerCase().includes(query.toLowerCase()),
                        ),
                      )
                      .map((c) => (
                        <View key={c.id} style={styles.card}>
                          <View style={styles.between}>
                            <Image
                              accessibilityLabel={c.name + " logo"}
                              source={brandLogos[c.id] || brandLogos.unknown}
                              style={{
                                width: 38,
                                height: 38,
                                backgroundColor: "#fafbf7",
                                borderRadius: 5,
                              }}
                              resizeMode="contain"
                            />
                            <Text style={styles.caption}>{c.category}</Text>
                          </View>
                          <Text
                            style={[styles.sectionTitle, { marginTop: 18 }]}
                          >
                            {c.name}
                          </Text>
                          <Text style={styles.body}>{c.description}</Text>
                          <Button
                            secondary
                            title="Connect card or UPI →"
                            onPress={() => setTab("Accounts")}
                          />
                        </View>
                      ))}
                  </>
                )}
                {tab === "Accounts" && (
                  <>
                    <Text style={styles.kicker}>
                      AUTOMATIC CARD & UPI TRACKING
                    </Text>
                    <Text style={styles.heading}>
                      Connect once. See the recurring picture.
                    </Text>
                    <Text style={styles.body}>
                      Supported payment feeds automatically reveal monthly and
                      yearly subscriptions. No manual additions or statement
                      uploads.
                    </Text>
                    {[
                      {
                        channel: "card",
                        name: "Connect your card",
                        text: "Read recurring card transactions with an authorized issuer or data provider. No card number or CVV is stored here.",
                        available: data?.integrations.bank.available,
                      },
                      {
                        channel: "upi",
                        name: "Connect UPI",
                        text: "Authorize permitted UPI payment history through a supported provider. UPI PIN authorization stays in your UPI app.",
                        available: data?.integrations.upi.available,
                      },
                    ].map((a) => (
                      <View key={a.channel} style={styles.card}>
                        <Text style={styles.sectionTitle}>{a.name}</Text>
                        <Text style={styles.body}>{a.text}</Text>
                        <Text style={styles.pending}>
                          {a.available
                            ? "● Provider configured"
                            : "● Approved provider setup required"}
                        </Text>
                        <Button
                          title={
                            a.available
                              ? "Continue to secure provider →"
                              : "Connection not available yet"
                          }
                          disabled={!a.available || busy}
                          onPress={async () => {
                            setBusy(true);
                            try {
                              const r = await api("/connections", {
                                channel: a.channel,
                              });
                              await Linking.openURL(r.authorizationUrl);
                            } catch (e) {
                              Alert.alert(
                                "Connection could not start",
                                e.message,
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        />
                      </View>
                    ))}
                    <View style={styles.notice}>
                      <Text style={styles.body}>
                        An account becomes connected only after verified
                        provider confirmation. A card number or UPI ID alone
                        does not grant transaction access.
                      </Text>
                    </View>
                  </>
                )}
                {tab === "Settings" && (
                  <>
                    <Text style={styles.heading}>
                      Your space.{"\n"}Your rules.
                    </Text>
                    <View style={styles.card}>
                      <Text style={styles.sectionTitle}>Appearance</Text>
                      <Text style={styles.body}>
                        Choose light or dark mode for this device.
                      </Text>
                      <ThemeToggle />
                    </View>
                    <View style={styles.card}>
                      <Text style={styles.sectionTitle}>{user?.name}</Text>
                      <Text style={styles.body}>{user?.email}</Text>
                      <Text style={styles.footnote}>
                        Your session is stored in your device’s protected
                        keychain / keystore.
                      </Text>
                    </View>
                    <View style={styles.card}>
                      <Text style={styles.sectionTitle}>Subwise Plus ✧</Text>
                      <Text style={styles.body}>
                        Membership:{" "}
                        {data?.integrations.testPlus
                          ? "Plus unlocked for testing · no payment needed"
                          : data?.billing.status}
                        .
                      </Text>
                      <Text style={styles.body}>
                        Test access unlocks Plus features. Live connections and
                        AI still require approved, configured providers. Store
                        billing is required before a paid native release.
                      </Text>
                    </View>
                    <View style={styles.card}>
                      <Text style={styles.sectionTitle}>
                        Your data belongs to you.
                      </Text>
                      <Text style={styles.body}>
                        Export and account deletion are available from the
                        website’s Settings page. Cancel any paid membership
                        before deleting your account.
                      </Text>
                    </View>
                    <Button
                      secondary
                      title="Sign out"
                      onPress={async () => {
                        try {
                          await api("/auth/logout", {});
                        } catch {}
                        await SecureStore.deleteItemAsync("subwise.session");
                        setToken(null);
                        setData(null);
                        setUser(null);
                      }}
                    />
                  </>
                )}
                <Text style={styles.footnote}>
                  subwise. A little less noise. A little more life.
                </Text>
              </ScrollView>
            </Animated.View>
            <View style={styles.tabs}>
              {[
                ["Home", "◫"],
                ["Subscriptions", "▤"],
                ["Discover", "⊕"],
                ["Accounts", "▣"],
                ["Settings", "⚙"],
              ].map(([label, icon]) => (
                <Pressable
                  key={label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === label }}
                  onPress={() => setTab(label)}
                  style={styles.tab}
                >
                  <Text
                    style={{
                      fontSize: 22,
                      color:
                        tab === label
                          ? isDark
                            ? "#b1cfa8"
                            : "#24563b"
                          : isDark
                            ? "#91a18a"
                            : "#a4ae9d",
                    }}
                  >
                    {icon}
                  </Text>
                  <Text
                    style={[
                      styles.tabLabel,
                      tab === label && {
                        color: isDark ? "#b1cfa8" : "#24563b",
                        fontWeight: "700",
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        <Modal
          visible={!!modal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setModal(null)}
        >
          <SafeAreaView style={styles.safe}>
            <View style={styles.modalHead}>
              <Text style={styles.wordmark}>subwise.</Text>
              <Pressable
                accessibilityLabel="Close dialog"
                onPress={() => setModal(null)}
              >
                <Text style={styles.link}>Close ✕</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              {modal === "profile" && (
                <Profile
                  api={api}
                  user={user}
                  onUpdated={(values) =>
                    setUser((current) => ({ ...current, ...values }))
                  }
                />
              )}
              {modal === "manage" && selected && (
                <>
                  <Text style={styles.heading}>{selected.name}</Text>
                  <Text style={styles.subtitle}>
                    {currency(selected.amount)} / {selected.cadence}
                  </Text>
                  <View style={styles.card}>
                    <Text style={styles.body}>
                      Next renewal: {shortDate(selected.next_date)}
                    </Text>
                    <Text style={styles.body}>
                      Status: {selected.status.replaceAll("_", " ")}
                    </Text>
                    <Text style={styles.body}>Payment: {selected.payment}</Text>
                  </View>
                  <Cancellation
                    key={selected.id}
                    subscription={selected}
                    api={api}
                    refresh={refresh}
                  />
                  {selected.status === "needs_review" && (
                    <Button
                      title="Confirm this subscription is active ✓"
                      onPress={() => change(selected, "active")}
                    />
                  )}

                  <Button
                    secondary
                    title="Remove from tracking"
                    onPress={() =>
                      Alert.alert(
                        "Remove record?",
                        "This removes tracking only. It does not cancel your service.",
                        [
                          { text: "Keep", style: "cancel" },
                          {
                            text: "Remove",
                            style: "destructive",
                            onPress: async () => {
                              try {
                                await api(
                                  "/subscriptions/" + selected.id,
                                  {},
                                  "DELETE",
                                );
                                await refresh();
                                setModal(null);
                              } catch (e) {
                                Alert.alert("Could not remove", e.message);
                              }
                            },
                          },
                        ],
                      )
                    }
                  />
                </>
              )}
              {modal === "ai" && (
                <>
                  <Text style={styles.kicker}>YOUR SUBSCRIPTION COPILOT</Text>
                  <Text style={styles.heading}>
                    A little help.{"\n"}More headspace.
                  </Text>
                  <Text style={styles.body}>
                    I can help review your costs. You review every change.
                  </Text>
                  {!data?.integrations.ai.available && (
                    <View style={styles.notice}>
                      <Text style={styles.body}>
                        AI is not connected. The operator needs to configure an
                        AI provider key.
                      </Text>
                    </View>
                  )}
                  {messages.map((m, i) => (
                    <View
                      key={i}
                      style={[
                        styles.card,
                        m.role === "user" && {
                          backgroundColor: isDark ? "#293d28" : "#e5eddb",
                        },
                      ]}
                    >
                      <Text style={styles.body}>{m.text}</Text>
                      {m.proposal && (
                        <Button
                          secondary
                          title={"Review automatic cancellation"}
                          onPress={() => {
                            const p = m.proposal;
                            if (p.type === "cancellation") {
                              setSelected(
                                subs.find((x) => x.id === p.subscriptionId),
                              );
                              setModal("manage");
                            }
                          }}
                        />
                      )}
                    </View>
                  ))}
                  <View
                    style={[
                      styles.row,
                      { alignItems: "center", marginTop: 20 },
                    ]}
                  >
                    <Switch
                      value={aiConsent}
                      onValueChange={setAiConsent}
                      trackColor={{ true: "#78965d" }}
                    />
                    <Text style={[styles.caption, { flex: 1 }]}>
                      Allow sharing subscription names and prices with the AI
                      provider for this conversation.
                    </Text>
                  </View>
                  <TextInput
                    style={[styles.input, { marginTop: 15, minHeight: 90 }]}
                    multiline
                    value={aiText}
                    onChangeText={setAiText}
                    placeholder="Ask about your subscriptions…"
                  />
                  <Button
                    title={busy ? "Thinking…" : "Ask Subwise ✧"}
                    disabled={
                      busy ||
                      !aiConsent ||
                      !data?.integrations.ai.available ||
                      !aiText.trim()
                    }
                    onPress={async () => {
                      const message = aiText;
                      setAiText("");
                      setMessages((m) => [
                        ...m,
                        { role: "user", text: message },
                      ]);
                      setBusy(true);
                      try {
                        const r = await api("/assistant", {
                          message,
                          shareData: aiConsent,
                        });
                        setMessages((m) => [
                          ...m,
                          {
                            role: "assistant",
                            text: r.message,
                            proposal: r.proposal,
                          },
                        ]);
                      } catch (e) {
                        setMessages((m) => [
                          ...m,
                          { role: "assistant", text: e.message },
                        ]);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                  <Text style={styles.footnote}>
                    AI can make mistakes. Verify advice with your provider.
                  </Text>
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const lightStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f4f5f1",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 15,
    backgroundColor: "#f4f5f1",
  },
  topbar: {
    paddingHorizontal: 23,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#dfe4df",
    backgroundColor: "#fcfcfa",
  },
  wordmark: {
    fontSize: 26,
    fontWeight: "700",
    color: "#174b3a",
    letterSpacing: -1.1,
  },
  avatar: {
    height: 35,
    width: 35,
    borderRadius: 8,
    backgroundColor: "#e5ebdf",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  kicker: {
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: "#71816d",
    marginTop: 8,
    fontWeight: "500",
  },
  heading: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 28,
    fontWeight: "400",
    color: "#263c32",
    letterSpacing: -0.7,
    lineHeight: 35,
    marginVertical: 18,
  },
  subtitle: {
    fontSize: 13,
    color: "#6f786c",
    marginBottom: 24,
    lineHeight: 21,
  },
  balance: {
    backgroundColor: "#174b3a",
    borderRadius: 6,
    padding: 23,
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 12,
    color: "#d4dfcf",
  },
  balanceValue: {
    fontSize: 42,
    fontWeight: "400",
    letterSpacing: -1.2,
    color: "#f4f5e9",
    marginVertical: 18,
    fontVariant: ["tabular-nums"],
  },
  balanceSmall: {
    fontSize: 12,
    color: "#c1cfb9",
    letterSpacing: 0,
  },
  row: {
    flexDirection: "row",
    gap: 14,
  },
  miniCard: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "#dfe4df",
    borderRadius: 0,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#d8dfd4",
    paddingHorizontal: 2,
    paddingVertical: 17,
  },
  miniValue: {
    fontSize: 30,
    color: "#354735",
    marginTop: 14,
    fontWeight: "400",
    fontVariant: ["tabular-nums"],
  },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dfe4df",
    borderRadius: 6,
    padding: 20,
    marginVertical: 18,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "500",
    color: "#354735",
    letterSpacing: -0.25,
  },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 7,
  },
  caption: {
    fontSize: 11,
    color: "#6f786c",
    marginTop: 5,
    lineHeight: 18,
  },
  body: {
    fontSize: 13,
    color: "#6f786c",
    lineHeight: 23,
    marginTop: 10,
  },
  progressTrack: {
    backgroundColor: "#edf1e6",
    height: 6,
    borderRadius: 3,
    marginTop: 10,
  },
  aiBanner: {
    backgroundColor: "#eef0e7",
    borderWidth: 1,
    borderColor: "#dce2d2",
    borderRadius: 6,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 17,
  },
  subscription: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e9ede3",
  },
  brand: {
    width: 38,
    height: 38,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: {
    color: "white",
    fontSize: 24,
    fontWeight: "700",
  },
  itemName: {
    fontSize: 14,
    color: "#354735",
    fontWeight: "500",
  },
  button: {
    backgroundColor: "#174b3a",
    borderRadius: 5,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    marginTop: 12,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "500",
  },
  secondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccd7cc",
  },
  label: {
    fontSize: 12,
    color: "#5d7350",
    marginBottom: 9,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cddbc1",
    backgroundColor: "white",
    borderRadius: 4,
    padding: 13,
    fontSize: 14,
    color: "#385b2a",
  },
  notice: {
    backgroundColor: "#f1f5e9",
    padding: 16,
    borderWidth: 1,
    borderColor: "#e1e9d4",
    borderRadius: 4,
    marginVertical: 18,
  },
  pending: {
    fontSize: 11,
    color: "#8d7444",
    marginTop: 17,
    lineHeight: 18,
  },
  footnote: {
    fontSize: 11,
    color: "#7e8b73",
    lineHeight: 19,
    textAlign: "center",
    marginTop: 27,
  },
  link: {
    fontSize: 12,
    color: "#4c6c43",
    fontWeight: "500",
  },
  tabs: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: "#dfe4d7",
    backgroundColor: "#fcfcfa",
    paddingTop: 12,
    paddingBottom: 8,
  },
  tab: {
    alignItems: "center",
    gap: 4,
    minWidth: 53,
    padding: 3,
  },
  tabLabel: {
    fontSize: 9,
    color: "#7d8b71",
  },
  auth: {
    padding: 25,
    paddingBottom: 50,
  },
  authHero: {
    backgroundColor: "#174b3a",
    borderRadius: 8,
    padding: 25,
    marginVertical: 25,
  },
  authTitle: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 43,
    lineHeight: 48,
    fontWeight: "400",
    color: "#f4f5e9",
    letterSpacing: -1.1,
    marginVertical: 22,
  },
  authSubtitle: {
    color: "#c0cfb4",
    fontSize: 12,
    lineHeight: 21,
  },
  title: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 28,
    color: "#354735",
    fontWeight: "400",
    marginBottom: 22,
    letterSpacing: -0.5,
  },
  error: {
    fontSize: 12,
    color: "#aa6753",
    backgroundColor: "#faf0e9",
    padding: 14,
    borderRadius: 4,
    marginVertical: 12,
    lineHeight: 19,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 22,
    borderBottomWidth: 1,
    borderBottomColor: "#dfe4d7",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#d8e1ce",
    backgroundColor: "white",
  },
  selectedChip: {
    backgroundColor: "#e7eddc",
    borderColor: "#9cac85",
  },
  chipText: {
    fontSize: 11,
    color: "#5d754c",
  },
});

// Presentation palette only; styles and dimensions are shared between modes.
const darkPalette = {
  "#f4f5f1": "#121a16",
  "#fcfcfa": "#151e18",
  "#ffffff": "#19251d",
  "#fff": "#19251d",
  white: "#19251d",
  "#dfe4df": "#2e3e2c",
  "#174b3a": "#bcd1bd",
  "#e5ebdf": "#31412d",
  "#71816d": "#99ac87",
  "#263c32": "#e4e9df",
  "#6f786c": "#a0af92",
  "#d4dfcf": "#d4dfcf",
  "#f4f5e9": "#f4f5e9",
  "#c1cfb9": "#c1cfb9",
  "#d8dfd4": "#2e3e2c",
  "#354735": "#dce3d5",
  "#edf1e6": "#2c3a27",
  "#eef0e7": "#273121",
  "#dce2d2": "#3b4731",
  "#e9ede3": "#2e3d2a",
  "#ccd7cc": "#42553a",
  "#5d7350": "#b1bfa2",
  "#cddbc1": "#415238",
  "#385b2a": "#dce3d5",
  "#f1f5e9": "#293725",
  "#e1e9d4": "#425338",
  "#8d7444": "#dcc795",
  "#7e8b73": "#a3b492",
  "#4c6c43": "#a5b997",
  "#dfe4d7": "#374730",
  "#7d8b71": "#a4b997",
  "#c0cfb4": "#c0cdb6",
  "#aa6753": "#e8bba0",
  "#faf0e9": "#3a2b1d",
  "#d8e1ce": "#3f5237",
  "#e7eddc": "#33432e",
  "#9cac85": "#748e61",
  "#5d754c": "#bfccb3",
};
const darkStyleValues = Object.fromEntries(
  Object.entries(lightStyles).map(([key, value]) => [
    key,
    Object.fromEntries(
      Object.entries(value).map(([property, current]) => [
        property,
        typeof current === "string" ? darkPalette[current] || current : current,
      ]),
    ),
  ]),
);
const darkStyles = StyleSheet.create({
  ...darkStyleValues,
  balance: { ...lightStyles.balance, backgroundColor: "#2d4134" },
  button: { ...lightStyles.button, backgroundColor: "#3a5541" },
  buttonText: { ...lightStyles.buttonText, color: "#eff1ea" },
  authHero: { ...lightStyles.authHero, backgroundColor: "#24362b" },
  wordmark: { ...lightStyles.wordmark, color: "#e4e9df" },
});
