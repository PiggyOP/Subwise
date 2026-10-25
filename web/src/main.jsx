import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Layers,
  Compass,
  Wallet,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  Bell,
  ChevronDown,
  ShieldCheck,
  Sparkles,
  X,
  Check,
  Upload,
  LogOut,
  Download,
  Menu,
  CalendarDays,
  Link2,
  CreditCard,
  Command,
  Send,
  CheckCircle2,
  ExternalLink,
  Trash2,
  UserRound,
} from "lucide-react";
import "./style.css";
import Profile from "./Profile";
import Cancellation from "./Cancellation";
import { ThemeProvider, ThemeToggle } from "./theme";
const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n / 100);
const date = (s) =>
  new Date(s + "T12:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
async function api(path, body, method) {
  const r = await fetch("/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({ error: "Request failed" }));
  if (!r.ok) throw Error(data.error || "Request failed");
  return data;
}
const today = new Date();
const due = (days) => {
  let d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const samples = [
  ["Netflix", 64900, "Entertainment", "Card", 3],
  ["Spotify Premium", 11900, "Entertainment", "UPI", 5],
  ["YouTube Premium", 14900, "Entertainment", "UPI", 8],
  ["iCloud+", 7500, "Storage", "Card", 11],
  ["Notion", 960000, "Productivity", "Card", 14],
  ["Adobe Creative Cloud", 59900, "Productivity", "Card", 18],
].map(([name, amount, category, payment, days], i) => ({
  id: "sample-" + i,
  name,
  amount,
  category,
  payment,
  next_date: due(days),
  cadence: name === "Notion" ? "yearly" : "monthly",
  status: "active",
  source: payment === "UPI" ? "upi" : "card",
}));
function App() {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [catalog, setCatalog] = useState([]),
    [data, setData] = useState(null),
    [demo, setDemo] = useState(false),
    [page, setPage] = useState("Overview"),
    [modal, setModal] = useState(null),
    [selected, setSelected] = useState(null),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [catalogCategory, setCatalogCategory] = useState("All"),
    [assistant, setAssistant] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false);
  const notify = (m) => {
    setToast(m);
    setTimeout(() => setToast(""), 5000);
  };
  async function refresh() {
    try {
      setData(await api("/dashboard"));
    } catch (e) {
      notify(e.message);
    }
  }
  useEffect(() => {
    api("/catalog").then(setCatalog);
    api("/me")
      .then(async (u) => {
        setUser(u);
        await refresh();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user || demo) return;
    const sync = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = setInterval(sync, 30000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [user?.id, demo]);
  function startDemo() {
    setDemo(true);
    setUser({ name: "Alex", email: "sample@subwise.local" });
    setData({
      subscriptions: samples,
      transactions: [],
      audit: [],
      billing: { status: "test_plus", test: true },
      integrations: {
        bank: { available: false },
        upi: { available: false },
        ai: { available: false },
        billing: { available: false },
        testPlus: true,
      },
    });
  }
  async function mutate(path, body, method) {
    if (demo) {
      notify(
        "This is a sample workspace. Create your account to save changes.",
      );
      return false;
    }
    try {
      await api(path, body, method);
      await refresh();
      return true;
    } catch (e) {
      notify(e.message);
      return false;
    }
  }
  useEffect(() => {
    if (!modal && !assistant) return;
    const before = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    const focusables = () => [
      ...(dialog?.querySelectorAll(
        'button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]',
      ) || []),
    ];
    focusables()[0]?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        setModal(null);
        setAssistant(false);
      }
      if (e.key === "Tab") {
        const elements = focusables(),
          first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [modal, assistant]);
  const subs = data?.subscriptions || [],
    active = subs.filter((x) =>
      ["active", "cancellation_requested"].includes(x.status),
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
    upcoming = active.filter((x) => x.next_date >= due(0)).slice(0, 5),
    filtered = subs.filter(
      (x) =>
        (category === "All" || x.category === category) &&
        x.name.toLowerCase().includes(query.toLowerCase()),
    ),
    categories = [...new Set(active.map((x) => x.category))];
  const findBrand = (name) => catalog.find((x) => x.name === name);
  const brand = (name, small = false) => {
    const service = findBrand(name);
    return (
      <span className={"brand realbrand " + (small ? "small" : "")}>
        <img
          src={service?.logo || "/logos/unknown.svg"}
          alt={service ? service.name + " logo" : "Unrecognized merchant"}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = "/logos/unknown.svg";
          }}
        />
      </span>
    );
  };
  async function startConnection(channel) {
    if (demo) {
      setSelected({ channel });
      setModal("connect");
      return;
    }
    try {
      const r = await api("/connections", { channel });
      window.location.assign(r.authorizationUrl);
    } catch (e) {
      notify(e.message);
    }
  }
  useEffect(() => {
    if (selected && data) {
      const current = data.subscriptions.find((s) => s.id === selected.id);
      if (current) setSelected(current);
    }
  }, [data]);
  function manage(s) {
    setSelected(s);
    setModal("manage");
  }
  if (loading || (user && !data))
    return (
      <div className="loading">
        <span className="wordmark">
          <span className="logo">s</span>subwise
        </span>
        <span className="spinner" />
      </div>
    );
  if (!user)
    return (
      <Auth
        onDone={async (u) => {
          setUser(u);
          await refresh();
        }}
        onDemo={startDemo}
      />
    );
  return (
    <div className="app">
      <aside className={mobileMenu ? "sidebar open" : "sidebar"}>
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("Overview");
          }}
        >
          <span className="logo">s</span>subwise
          <span className="worddot">.</span>
        </a>
        <div className="workspace">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <b>Personal workspace</b>
            <small>{demo ? "Sample account" : "Your private space"}</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="navlabel">WORKSPACE</div>
        <nav>
          {[
            [LayoutDashboard, "Overview"],
            [Layers, "Subscriptions"],
            [Compass, "Discover"],
            [Wallet, "Accounts"],
          ].map(([Icon, label]) => (
            <button
              key={label}
              className={page === label ? "navitem current" : "navitem"}
              onClick={() => {
                setPage(label);
                setQuery("");
                setMobileMenu(false);
              }}
            >
              <Icon size={19} />
              {label}
              {label === "Subscriptions" && (
                <span className="count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="navlabel second">YOUR COPILOT</div>
        <button className="navitem" onClick={() => setAssistant(true)}>
          <Sparkles size={19} />
          Subwise AI <span className="new">NEW</span>
        </button>
        <div className="sidebottom">
          <div className="upgrade">
            <span className="tinySpark">✧</span>
            <h3>
              Less spending.
              <br />
              More living.
            </h3>
            <p>
              Meet your subscription
              <br />
              superpowers with Plus.
            </p>
            <button onClick={() => setPage("Settings")}>
              {data.integrations.testPlus
                ? "Plus unlocked · testing"
                : "Explore Plus"}{" "}
              <Check size={16} />
            </button>
          </div>
          <button
            className={"navitem " + (page === "Settings" ? "current" : "")}
            onClick={() => setPage("Settings")}
          >
            <Settings size={19} />
            Settings
          </button>

          <button
            className="navitem signout-control"
            onClick={async () => {
              if (!demo) await api("/auth/logout", {});
              setUser(null);
              setDemo(false);
              setData(null);
            }}
          >
            Sign out
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            <button
              className="mobile-menu"
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              <Menu size={22} />
            </button>
            Workspace <span>/</span> <b>{page}</b>
          </div>
          <div className="headeractions">
            <span className="pill">
              {data.integrations.testPlus
                ? "Plus · test access"
                : "Personal account"}
            </span>
            <span className="secure">
              <ShieldCheck size={14} /> Private by design
            </span>
            <button
              className="iconbutton"
              aria-label="Upcoming renewals"
              onClick={() => setModal("renewals")}
            >
              <Bell size={19} />
              {upcoming.length > 0 && <i />}
            </button>
            <button
              className="avatar neutral profile-trigger"
              aria-label="Open profile"
              aria-expanded={modal === "profile"}
              onClick={() => setModal("profile")}
            >
              {user.name.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <div className="content">
          {demo && (
            <div className="samplebar">
              <span>
                Sample workspace · All amounts and accounts shown here are
                examples.
              </span>
              <button
                onClick={() => {
                  setUser(null);
                  setDemo(false);
                  setData(null);
                }}
              >
                Create your account <ArrowRight size={14} />
              </button>
            </div>
          )}
          {data.access === false && (
            <div className="samplebar">
              <span>
                Your membership is inactive. Subscribe to access your
                subscription workspace.
              </span>
              <button onClick={() => setPage("Settings")}>
                Open membership settings <ArrowRight size={14} />
              </button>
            </div>
          )}
          <div className="pageheading">
            <div>
              <div className="eyebrow">YOUR MONEY, A LITTLE MORE MINDFUL</div>
              <h1>
                {page === "Overview"
                  ? `A little clarity. A lot more control.`
                  : page === "Accounts"
                    ? "Connected, on your terms."
                    : page === "Discover"
                      ? "Find your next favourite."
                      : page === "Profile"
                        ? "A profile that’s yours."
                        : page === "Settings"
                          ? "Your space. Your rules."
                          : "Everything you subscribe to."}
              </h1>
              <p>
                {page === "Overview"
                  ? `Welcome back, ${user.name.split(" ")[0]}. Let’s make your subscriptions work for you.`
                  : page === "Discover"
                    ? "120 services, recognized automatically from supported payment feeds."
                    : page === "Accounts"
                      ? "Bring your recurring payments together, with your permission."
                      : page === "Profile"
                        ? "Your details, linked email, and monthly subscription summaries."
                        : page === "Settings"
                          ? "Manage your membership, privacy, and account."
                          : "A clear view of what you pay for, and when."}
              </p>
            </div>
            {["Overview", "Subscriptions"].includes(page) && (
              <button className="primary" onClick={() => setPage("Accounts")}>
                <Link2 size={16} />
                Connect card or UPI
              </button>
            )}
          </div>
          {["Overview", "Subscriptions"].includes(page) && (
            <section className="panel subscriptions">
              <div className="panelhead">
                <div>
                  <h2>
                    {page === "Overview"
                      ? "Your subscriptions"
                      : "Subscription manager"}{" "}
                    <span className="numberbadge">{subs.length}</span>
                  </h2>
                  <p>Good things, all in one place.</p>
                </div>
                <div className="tabletools">
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Search subscriptions"
                      placeholder="Search subscriptions"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Filter category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option>All</option>
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>SUBSCRIPTION</th>
                      <th>CATEGORY</th>
                      <th>AMOUNT</th>
                      <th>NEXT PAYMENT</th>
                      <th>STATUS</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.id} onClick={() => manage(s)}>
                        <td>
                          <div className="service">
                            {brand(s.name)}
                            <div>
                              <b>{s.name}</b>
                              <small>
                                {s.source === "upi"
                                  ? "Detected via UPI"
                                  : "Detected via card"}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="tag">{s.category}</span>
                        </td>
                        <td>
                          <b>{money(s.amount)}</b>
                          <small>
                            {" "}
                            /{" "}
                            {s.cadence === "monthly"
                              ? "month"
                              : s.cadence === "yearly"
                                ? "year"
                                : "week"}
                          </small>
                        </td>
                        <td>{date(s.next_date)}</td>
                        <td>
                          <span className={"status " + s.status}>
                            <i />
                            {s.status === "cancellation_requested"
                              ? "Requested"
                              : s.status === "cancelled"
                                ? "Cancelled"
                                : s.status === "needs_review"
                                  ? "Review"
                                  : "Active"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="iconbutton"
                            aria-label={"Manage " + s.name}
                            onClick={(e) => {
                              e.stopPropagation();
                              manage(s);
                            }}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!filtered.length && (
                <div className="empty">
                  <Layers size={30} />
                  <h3>
                    {query
                      ? "No matching subscriptions"
                      : "Make space for clarity"}
                  </h3>
                  <p>
                    Connect a supported card or UPI account. Monthly and yearly
                    subscriptions appear automatically.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setPage("Accounts")}
                  >
                    <Link2 size={16} />
                    Connect card or UPI
                  </button>
                </div>
              )}
              <div className="tablefooter">
                <ShieldCheck size={14} /> Your subscriptions are visible only in
                your account.
                <button className="primary" onClick={() => setPage("Accounts")}>
                  <Link2 size={16} />
                  Connect card or UPI
                </button>
              </div>
            </section>
          )}
          {page === "Overview" && (
            <>
              <div className="stats">
                <div className="stat mainstat">
                  <div className="statlabel">
                    Monthly commitment <span>↗</span>
                  </div>
                  <div className="statvalue">
                    {money(monthly)}
                    <small>/ mo</small>
                  </div>
                  <div className="statfoot">
                    <span className="greenlight" /> {money(monthly * 12)}{" "}
                    projected per year
                  </div>
                </div>
                <div className="stat">
                  <div className="statlabel">
                    Active subscriptions <Layers size={17} />
                  </div>
                  <div className="statvalue">
                    {active.length.toString().padStart(2, "0")}
                    <small>subscriptions</small>
                  </div>
                  <div className="statfoot">
                    <span className="minidot" />
                    {categories.length} categories in your life
                  </div>
                </div>
                <div className="stat">
                  <div className="statlabel">
                    Renewing in 7 days <CalendarDays size={17} />
                  </div>
                  <div className="statvalue">
                    {money(
                      active
                        .filter(
                          (x) => x.next_date >= due(0) && x.next_date <= due(7),
                        )
                        .reduce((s, x) => s + x.amount, 0),
                    )}
                  </div>
                  <div className="statfoot">
                    <span className="amberdot" />
                    {
                      active.filter(
                        (x) => x.next_date >= due(0) && x.next_date <= due(7),
                      ).length
                    }{" "}
                    payments on the horizon
                  </div>
                </div>
              </div>
              <div className="overviewgrid">
                <section className="panel spending">
                  <div className="panelhead">
                    <div>
                      <h2>Your spending, in perspective</h2>
                      <p>A monthly view of your commitments</p>
                    </div>
                    <span className="pill">
                      This month <ChevronDown size={13} />
                    </span>
                  </div>
                  <div className="chartbody">
                    <div
                      className="donut"
                      style={{
                        background: categories.length
                          ? `conic-gradient(${categories
                              .map((c, i) => {
                                let start =
                                  (categories
                                    .slice(0, i)
                                    .reduce(
                                      (sum, k) =>
                                        sum +
                                        active
                                          .filter((s) => s.category === k)
                                          .reduce(
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
                                      0,
                                    ) /
                                    monthly) *
                                  100;
                                let end =
                                  start +
                                  (active
                                    .filter((s) => s.category === c)
                                    .reduce(
                                      (s, x) =>
                                        s +
                                        x.amount *
                                          (x.cadence === "yearly"
                                            ? 1 / 12
                                            : x.cadence === "weekly"
                                              ? 52 / 12
                                              : 1),
                                      0,
                                    ) /
                                    monthly) *
                                    100;
                                return `${["#164f40", "#a6c39d", "#d9e6bb", "#d7c6a4", "#8ca9c1", "#bba8d0", "#e5ae99"][i]} ${start}% ${end}%`;
                              })
                              .join(",")})`
                          : "#e8eeea",
                      }}
                    >
                      <div>
                        <small>Monthly total</small>
                        <b>{money(monthly)}</b>
                        <span>{active.length} subscriptions</span>
                      </div>
                    </div>
                    <div className="legend">
                      {categories.length ? (
                        categories.map((c, i) => {
                          let amount = active
                            .filter((s) => s.category === c)
                            .reduce(
                              (s, x) =>
                                s +
                                x.amount *
                                  (x.cadence === "yearly"
                                    ? 1 / 12
                                    : x.cadence === "weekly"
                                      ? 52 / 12
                                      : 1),
                              0,
                            );
                          return (
                            <div key={c}>
                              <i
                                style={{
                                  background: [
                                    "#164f40",
                                    "#a6c39d",
                                    "#d9e6bb",
                                    "#d7c6a4",
                                    "#8ca9c1",
                                    "#bba8d0",
                                    "#e5ae99",
                                  ][i],
                                }}
                              />
                              <span>{c}</span>
                              <b>{money(amount)}</b>
                              <small>
                                {Math.round((amount / monthly) * 100)}%
                              </small>
                            </div>
                          );
                        })
                      ) : (
                        <p>
                          Connect card or UPI to see
                          <br />
                          where your money goes.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="insight">
                    <span>↗</span>
                    <p>
                      {categories.length ? (
                        <>
                          <b>{categories[0]}</b> is part of your recurring
                          spending. A quick review can help keep it intentional.
                        </>
                      ) : (
                        "Your spending picture starts with a supported card or UPI connection."
                      )}
                    </p>
                  </div>
                </section>
                <section className="panel upcoming">
                  <div className="panelhead">
                    <div>
                      <h2>Coming up next</h2>
                      <p>No surprises on your statement</p>
                    </div>
                    <CalendarDays size={18} />
                  </div>
                  {upcoming.length ? (
                    upcoming.slice(0, 4).map((s) => (
                      <button
                        className="renewal"
                        key={s.id}
                        onClick={() => manage(s)}
                      >
                        {brand(s.name, true)}
                        <div>
                          <b>{s.name}</b>
                          <small>
                            {date(s.next_date)} · {s.payment}
                          </small>
                        </div>
                        <b>{money(s.amount)}</b>
                      </button>
                    ))
                  ) : (
                    <div className="empty smallEmpty">
                      <CalendarDays />
                      <p>No upcoming payments yet.</p>
                    </div>
                  )}
                  <button
                    className="textbutton full"
                    onClick={() => setModal("renewals")}
                  >
                    See all renewals <ArrowRight size={14} />
                  </button>
                </section>
              </div>
              <div className="assistantbanner">
                <div className="aiicon">
                  <Sparkles size={25} />
                </div>
                <div>
                  <span className="eyebrow">A LITTLE HELP GOES A LONG WAY</span>
                  <h2>Less admin. More peace of mind.</h2>
                  <p>Understand your subscriptions. Plan your next move.</p>
                </div>
                <button onClick={() => setAssistant(true)}>
                  Meet your assistant <ArrowUpRight size={16} />
                </button>
                <span className="bannerorb" />
              </div>
            </>
          )}

          {page === "Discover" && (
            <>
              <div className="discovertools">
                <label className="search">
                  <Search size={18} />
                  <input
                    placeholder="Find a service"
                    aria-label="Search services"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter services by category"
                  value={catalogCategory}
                  onChange={(e) => setCatalogCategory(e.target.value)}
                >
                  <option>All</option>
                  {[...new Set(catalog.map((c) => c.category))].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <span>120 services · Regional availability varies</span>
              </div>
              <div className="cataloggrid">
                {catalog
                  .filter(
                    (c) =>
                      (catalogCategory === "All" ||
                        c.category === catalogCategory) &&
                      [c.name, ...c.aliases].some((v) =>
                        v.toLowerCase().includes(query.toLowerCase()),
                      ),
                  )
                  .map((c) => (
                    <div className="panel catalogcard" key={c.id}>
                      {brand(c.name)}
                      <span className="tag">{c.category}</span>
                      <h2>{c.name}</h2>
                      <p>{c.description}</p>
                      <div>
                        <a href={c.url} target="_blank" rel="noreferrer">
                          Visit service <ExternalLink size={14} />
                        </a>
                        <button
                          className="primary"
                          onClick={() => setPage("Accounts")}
                        >
                          <Link2 size={16} />
                          Connect card or UPI
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
          {page === "Accounts" && (
            <>
              <div className="connectionhero">
                <div>
                  <span className="eyebrow">
                    AUTOMATIC, FROM THE FIRST CONNECTION
                  </span>
                  <h2>Your card. Your UPI. One clear picture.</h2>
                  <p>
                    Connect a supported payment account to read recurring
                    charges automatically.
                    <br />
                    Monthly and yearly subscriptions are detected from
                    authorized payment history.
                  </p>
                  <span className="status cancellation_requested">
                    <i />
                    {data.connections?.some((c) => c.status === "connected")
                      ? `${data.connections.filter((c) => c.status === "connected").length} payment account(s) connected`
                      : "No payment accounts connected"}
                  </span>
                </div>
                <div className="connectionart">
                  <CreditCard size={64} />
                  <span>
                    <ShieldCheck size={27} />
                  </span>
                </div>
              </div>
              <div className="trackingflow">
                <span>
                  <Link2 size={18} />
                  Connect securely
                </span>
                <ArrowRight size={17} />
                <span>
                  <Search size={18} />
                  Read recurring payments
                </span>
                <ArrowRight size={17} />
                <span>
                  <Layers size={18} />
                  See monthly & yearly plans
                </span>
              </div>
              <div className="accountsgrid twoaccounts">
                {[
                  {
                    channel: "card",
                    title: "Connect your card",
                    Icon: CreditCard,
                    text: "Authorize a supported issuer or transaction-data provider. Subwise reads recurring card charges without storing your card number or CVV.",
                    available: data.integrations.bank.available,
                  },
                  {
                    channel: "upi",
                    title: "Connect UPI",
                    Icon: Link2,
                    text: "Authorize a supported UPI provider to share permitted payment history. Mandate management needs a supported PSP and confirmation in your UPI app.",
                    available: data.integrations.upi.available,
                  },
                ].map(({ channel, title, Icon, text, available }) => (
                  <section className="panel accountcard" key={channel}>
                    <Icon size={29} />
                    <h2>{title}</h2>
                    <p>{text}</p>
                    <span
                      className={
                        "status " +
                        (available ? "active" : "cancellation_requested")
                      }
                    >
                      <i />
                      {available
                        ? "Provider configured"
                        : "Provider setup required"}
                    </span>
                    <button
                      className="primary wide"
                      onClick={() => {
                        setSelected({ channel });
                        setModal("connect");
                      }}
                    >
                      {title}
                      <ArrowUpRight size={16} />
                    </button>
                  </section>
                ))}
              </div>
              <section className="panel activity">
                <h2>What Subwise reads</h2>
                <p>
                  Merchant name, transaction amount, payment date, and
                  recurrence pattern from authorized feeds. No manual additions
                  or CSV uploads. Credentials and payment authorization stay
                  with the provider.
                </p>
                <div className="notice">
                  <ShieldCheck size={18} />
                  <p>
                    Automatic tracking is unavailable until an approved provider
                    is configured. A card number or UPI ID alone cannot grant
                    access to payment history.
                  </p>
                </div>
              </section>
            </>
          )}

          {page === "Settings" && (
            <section className="panel settings-appearance">
              <div>
                <h2>Appearance</h2>
                <p>
                  Choose light or dark mode. Your preference is saved on this
                  device.
                </p>
              </div>
              <ThemeToggle />
            </section>
          )}
          {page === "Settings" && (
            <SettingsPage
              data={data}
              demo={demo}
              notify={notify}
              refresh={refresh}
              onDelete={() => {
                setUser(null);
                setData(null);
              }}
            />
          )}
          <footer>
            <span className="wordmark footerbrand">
              <span className="logo">s</span>subwise.
            </span>
            <p>A little less noise. A little more life.</p>
            <span>
              <ShieldCheck size={14} /> Built around your privacy
            </span>
          </footer>
        </div>
      </main>
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={18} />
          {toast}
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modalbackdrop"
          onClick={() => {
            setModal(null);
            setSelected(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "profile"
                ? "Your profile"
                : modal === "manage"
                  ? "Manage subscription"
                  : "Connect payment account"
            }
            className={"modal " + (modal === "profile" ? "account-panel" : "")}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modalclose iconbutton"
              aria-label="Close dialog"
              onClick={() => {
                setModal(null);
                setSelected(null);
              }}
            >
              <X size={21} />
            </button>

            {modal === "profile" && (
              <Profile
                api={api}
                user={user}
                demo={demo}
                notify={notify}
                onUpdated={(values) =>
                  setUser((current) => ({ ...current, ...values }))
                }
              />
            )}
            {modal === "manage" && selected && (
              <>
                <div className="detailhero">
                  {brand(selected.name)}
                  <h2>{selected.name}</h2>
                  <p>
                    {money(selected.amount)} /{" "}
                    {selected.cadence.replace("ly", "")}
                  </p>
                </div>
                <div className="detailrow">
                  <span>Next payment</span>
                  <b>{date(selected.next_date)}</b>
                </div>
                <div className="detailrow">
                  <span>Payment method</span>
                  <b>{selected.payment}</b>
                </div>
                <div className="detailrow">
                  <span>Subscription status</span>
                  <b>{selected.status.replaceAll("_", " ")}</b>
                </div>
                <Cancellation
                  key={selected.id}
                  subscription={selected}
                  demo={demo}
                  api={api}
                  refresh={refresh}
                  notify={notify}
                />
                {selected.status === "needs_review" && (
                  <>
                    <div className="notice">
                      <p>
                        Detected from past payments. Review the amount and next
                        date. Historical transactions do not prove this
                        subscription is still active.
                      </p>
                    </div>
                    <button
                      className="primary wide"
                      onClick={async () => {
                        if (
                          await mutate(
                            "/subscriptions/" + selected.id,
                            { status: "active" },
                            "PATCH",
                          )
                        ) {
                          setModal(null);
                          notify(
                            "Subscription confirmed active. Review its next renewal date if needed.",
                          );
                        }
                      }}
                    >
                      Confirm this subscription is active <Check size={16} />
                    </button>
                  </>
                )}
                <button
                  className="textbutton wide"
                  onClick={async () => {
                    if (
                      await mutate(
                        "/subscriptions/" + selected.id,
                        {},
                        "DELETE",
                      )
                    ) {
                      setModal(null);
                      notify(
                        "Removed from tracking. This does not cancel the service.",
                      );
                    }
                  }}
                >
                  <Trash2 size={15} />
                  Remove from tracking
                </button>
              </>
            )}

            {modal === "renewals" && (
              <>
                <span className="eyebrow">ON THE HORIZON</span>
                <h2>Upcoming renewals</h2>
                <p className="muted">
                  Based on the dates in your subscription records.
                </p>
                {upcoming.length ? (
                  upcoming.map((s) => (
                    <button
                      className="renewal"
                      key={s.id}
                      onClick={() => manage(s)}
                    >
                      {brand(s.name, true)}
                      <div>
                        <b>{s.name}</b>
                        <small>{date(s.next_date)}</small>
                      </div>
                      <b>{money(s.amount)}</b>
                    </button>
                  ))
                ) : (
                  <div className="empty">
                    <CalendarDays />
                    <p>No upcoming renewals recorded.</p>
                  </div>
                )}
              </>
            )}
            {modal === "connect" && (
              <>
                <span className="eyebrow">
                  YOU AUTHORIZE. SUBWISE ORGANIZES.
                </span>
                <h2>
                  {selected?.channel === "upi"
                    ? "Connect your UPI account"
                    : "Connect your card securely"}
                </h2>
                <p>
                  You'll authorize read access with a supported provider.
                  Subwise will use permitted payment history to identify monthly
                  and yearly subscriptions.
                </p>
                <div className="notice">
                  <ShieldCheck size={20} />
                  <p>
                    {(
                      selected?.channel === "upi"
                        ? data.integrations.upi.available
                        : data.integrations.bank.available
                    )
                      ? "A provider is configured. Continue to its secure authorization screen."
                      : "No approved provider is connected yet. Automatic tracking cannot start until provider access is configured. Do not enter card numbers, CVVs, OTPs, or a UPI PIN into Subwise."}
                  </p>
                </div>
                <ol className="connectionsteps">
                  <li>
                    Choose and authorize your supported account with the
                    provider.
                  </li>
                  <li>
                    Read-only transaction history is shared under your consent.
                  </li>
                  <li>
                    Subwise detects monthly and yearly recurring charges
                    automatically.
                  </li>
                </ol>
                <button
                  className="primary wide"
                  disabled={
                    !(selected?.channel === "upi"
                      ? data.integrations.upi.available
                      : data.integrations.bank.available)
                  }
                  onClick={() => startConnection(selected?.channel || "card")}
                >
                  Continue to secure provider <ArrowRight size={16} />
                </button>
                <p className="muted">
                  No account is marked connected until a verified provider
                  confirmation arrives.
                </p>
              </>
            )}
          </section>
        </div>
      )}
      {assistant && (
        <Assistant
          demo={demo}
          available={data.integrations.ai.available}
          onClose={() => setAssistant(false)}
          active={active}
          onPropose={(p) => {
            setAssistant(false);
            if (p.type === "cancellation") {
              const s = subs.find((x) => x.id === p.subscriptionId);
              if (s) manage(s);
            }
          }}
          onManage={(s) => {
            setAssistant(false);
            manage(s);
          }}
        />
      )}
    </div>
  );
}
function Auth({ onDone, onDemo }) {
  const [mode, setMode] = useState("register"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    let form = new FormData(e.target);
    try {
      let r = await api("/auth/" + mode, Object.fromEntries(form));
      await onDone(r.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <ThemeToggle className="auth-theme-toggle" />
      <section className="authstory">
        <span className="wordmark">
          <span className="logo">s</span>subwise.
        </span>
        <div>
          <span className="eyebrow">LESS MONEY ON AUTOPILOT. MORE LIFE.</span>
          <h1>
            Keep the good.
            <br />
            Let go of
            <br />
            <em>the forgotten.</em>
          </h1>
          <p>
            One calm place for your subscriptions,
            <br />
            recurring payments, and peace of mind.
          </p>
          <div className="authstack">
            <div>
              <span className="brand realbrand">
                <img src="/logos/netflix.svg" alt="Netflix logo" />
              </span>
              <span>
                Netflix<small>Your entertainment, accounted for.</small>
              </span>
              <ShieldCheck />
            </div>
            <div>
              <span className="brand realbrand">
                <img src="/logos/spotify.svg" alt="Spotify logo" />
              </span>
              <span>
                Spotify<small>Every little payment, in perspective.</small>
              </span>
              <CheckCircle2 />
            </div>
          </div>
        </div>
        <span className="authfoot">
          <ShieldCheck size={16} /> Your financial picture belongs to you.
        </span>
      </section>
      <section className="authform" key={mode}>
        <span className="eyebrow">A FRESH PERSPECTIVE ON YOUR PAYMENTS</span>
        <h2>
          {mode === "register"
            ? "Make room for what matters."
            : "Welcome back."}
        </h2>
        <p>
          {mode === "register"
            ? "Create your private Subwise workspace."
            : "A little clarity is waiting for you."}
        </p>
        <form onSubmit={submit} aria-busy={busy}>
          {mode === "register" && (
            <label>
              Your name
              <input
                name="name"
                required
                maxLength={80}
                autoComplete="name"
                placeholder="Alex Sharma"
              />
            </label>
          )}
          <label>
            Email address
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              required
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              placeholder="At least 12 characters"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className={"primary wide auth-submit" + (busy ? " is-pending" : "")}
            disabled={busy}
          >
            {busy
              ? "One moment…"
              : mode === "register"
                ? "Create your account"
                : "Sign in"}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="switchauth">
          {mode === "register" ? "Already have an account?" : "New to Subwise?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "register" ? "login" : "register");
              setError("");
            }}
          >
            {mode === "register" ? "Sign in" : "Create an account"}
          </button>
        </p>
        <div className="or">
          <span />
          OR TAKE A LOOK AROUND
          <span />
        </div>
        <button className="secondary wide" onClick={onDemo}>
          Explore the sample workspace <ArrowUpRight size={16} />
        </button>
        <p className="privacyfine">
          Connect supported card and UPI providers to automatically read
          subscriptions. Provider setup is required before live tracking.
        </p>
      </section>
    </div>
  );
}

function Assistant({ demo, available, onClose, active, onManage, onPropose }) {
  const [text, setText] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [messages, setMessages] = useState([]);
  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const message = text;
    setText("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const result = await api("/assistant", { message, shareData: consent });
      setMessages((m) => [
        ...m,
        { role: "assistant", text: result.message, proposal: result.proposal },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: e.message }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="assistantbackdrop" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Subwise assistant"
        className="assistantdrawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="assistanthead">
          <span className="aiicon">
            <Sparkles size={22} />
          </span>
          <div>
            <h2>Subwise AI</h2>
            <small>A little help. More headspace.</small>
          </div>
          <button
            className="iconbutton"
            aria-label="Close assistant"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="assistantmessages">
          <span className="eyebrow">YOUR SUBSCRIPTION COPILOT</span>
          <h2>
            Let’s make things
            <br />a little lighter.
          </h2>
          <p>
            I can help review costs and explain your options. You stay in
            control of every change.
          </p>
          {!available && (
            <div className="notice">
              <p>
                AI isn’t connected yet. The operator needs to configure an AI
                provider key. You can manage your subscriptions below.
              </p>
            </div>
          )}
          <div className="assistantchoices">
            {active.slice(0, 3).map((s) => (
              <button key={s.id} onClick={() => onManage(s)}>
                Manage {s.name}
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
          {messages.map((m, i) => (
            <div key={i} className={"message " + m.role}>
              {m.text}
              {m.proposal && (
                <button
                  className="secondary wide"
                  onClick={() => onPropose(m.proposal)}
                >
                  Review automatic cancellation <ArrowRight size={14} />
                </button>
              )}
            </div>
          ))}
          {busy && <p>Thinking through your subscriptions…</p>}
        </div>
        <form className="assistantinput" onSubmit={send}>
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Allow sharing subscription names and prices with the AI provider for
            this conversation.
          </label>
          <div>
            <input
              aria-label="Message assistant"
              placeholder="Ask about your subscriptions…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!available || demo}
            />
            <button
              aria-label="Send message"
              disabled={busy || !consent || !available || demo}
            >
              <Send size={18} />
            </button>
          </div>
          <small>
            AI advice can be incorrect. Actions require your review.
          </small>
        </form>
      </aside>
    </div>
  );
}
function SettingsPage({ data, demo, notify, refresh, onDelete }) {
  const [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  async function checkout() {
    if (demo) return notify("Create your own account to manage membership.");
    setBusy(true);
    try {
      const options = await api("/billing/checkout", {});
      await new Promise((resolve, reject) => {
        if (window.Razorpay) return resolve();
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = resolve;
        s.onerror = () => reject(Error("Could not load payment checkout"));
        document.head.appendChild(s);
      });
      const r = new window.Razorpay({
        ...options,
        name: "Subwise Plus",
        description: "Subscription management membership",
        handler: () => {
          notify(
            "Payment submitted. Membership activates after the signed provider webhook arrives.",
          );
          refresh();
        },
      });
      r.open();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settingsgrid">
      <section
        className={
          "panel membership" +
          (data.billing.status === "active" || data.integrations.testPlus
            ? " is-member"
            : "") +
          (busy ? " is-pending" : "")
        }
        aria-busy={busy}
      >
        <span className="eyebrow">A LITTLE MORE POWER</span>
        <h2>
          Meet Subwise Plus <Sparkles size={23} />
        </h2>
        <p>
          Subscription tracking, recurring-payment detection, and your AI
          assistant in one membership.
        </p>
        <div className="planprice">
          {data.integrations.testPlus
            ? "Plus unlocked for testing"
            : "Provider-configured pricing"}
        </div>
        <p>
          {data.integrations.testPlus
            ? "Testing access includes all Plus features with no charge. Financial connections and AI still require configured providers."
            : "Review the exact amount and billing interval in secure Razorpay checkout. Financial features depend on supported providers."}
        </p>
        <ul>
          <li>
            <Check size={17} />
            Unlimited tracked subscriptions
          </li>
          <li>
            <Check size={17} />
            Automatic monthly & yearly detection
          </li>
          <li>
            <Check size={17} />
            AI insights when the provider is configured
          </li>
          <li>
            <Check size={17} />
            Export your data at any time
          </li>
        </ul>
        <div className="notice">
          <p>
            Membership:{" "}
            <b>
              {data.integrations.testPlus
                ? "Plus · test access"
                : data.billing.status}
            </b>
            {data.integrations.paidGate
              ? " · Paid access required"
              : " · Paid access enforcement is currently off"}
            .{" "}
            {data.integrations.testPlus
              ? "No payment is needed during testing."
              : data.integrations.billing.available
                ? "Checkout is connected."
                : "Checkout awaits payment-provider setup."}
          </p>
        </div>
        <button
          className="primary wide"
          disabled={
            busy ||
            data.integrations.testPlus ||
            !data.integrations.billing.available
          }
          onClick={checkout}
        >
          {busy
            ? "Opening checkout…"
            : data.integrations.testPlus
              ? "Plus is unlocked — no payment needed"
              : data.integrations.billing.available
                ? "Open secure checkout"
                : "Checkout not configured"}
          <ArrowUpRight size={16} />
        </button>
        {data.billing.status === "active" && (
          <button
            className="textbutton wide"
            onClick={async () => {
              try {
                const r = await api("/billing/cancel", {});
                notify(r.message);
                await refresh();
              } catch (e) {
                notify(e.message);
              }
            }}
          >
            Cancel membership at period end
          </button>
        )}
      </section>
      <section className="panel privacycard">
        <ShieldCheck size={28} />
        <h2>Your data belongs to you.</h2>
        <p>
          We store recurring payments from authorized card and UPI feeds. No
          bank passwords, card numbers, OTPs, or UPI PINs are needed.
        </p>
        <button
          className="secondary wide"
          onClick={async () => {
            if (demo)
              return notify("Sample accounts have no personal data to export.");
            const r = await api("/export"),
              url = URL.createObjectURL(
                new Blob([JSON.stringify(r, null, 2)], {
                  type: "application/json",
                }),
              );
            let a = document.createElement("a");
            a.href = url;
            a.download = "subwise-export.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export my data <Download size={17} />
        </button>
        <h3>Delete your account</h3>
        <p>
          This permanently removes your detected subscriptions, connected-feed
          transactions, sessions, and activity. Cancel any paid membership
          first.
        </p>
        {!confirmDelete ? (
          <button className="danger" onClick={() => setConfirmDelete(true)}>
            Delete account
          </button>
        ) : (
          <>
            <p className="error">Permanently delete all your Subwise data?</p>
            <button
              className="danger"
              onClick={async () => {
                if (demo) return notify("This is a sample workspace.");
                try {
                  await api("/account", {}, "DELETE");
                  onDelete();
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              Yes, permanently delete
            </button>
            <button
              className="textbutton"
              onClick={() => setConfirmDelete(false)}
            >
              Keep account
            </button>
          </>
        )}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
