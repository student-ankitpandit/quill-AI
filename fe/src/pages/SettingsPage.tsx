import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CreditCard,
  ExternalLink,
  Github,
  LayoutGrid,
  Search,
  UserCircle,
} from "lucide-react";
import {
  clearAuth,
  createRazorpayOrder,
  getBillingHistory,
  getManageInstallUrl,
  getPlanUsage,
  getUserProfile,
  isLoggedIn,
  verifyRazorpayPayment,
  type BillingHistoryItem,
  type PlanUsage,
  type QuillProfile,
  type RazorpayOrder,
} from "@/lib/api";
import { RazorpayCheckout } from "@/components/RazorpayCheckout";
import "./SettingsPage.css";

type Section = "Overview" | "Usage" | "Plan & billing" | "Account" | "Connections";

const SETTINGS_CACHE_MS = 15_000;
let profileCache: { value: QuillProfile; fetchedAt: number } | null = null;
let usageCache: { value: PlanUsage; fetchedAt: number } | null = null;
let billingCache: { value: BillingHistoryItem[]; fetchedAt: number } | null = null;
let profileRequest: Promise<QuillProfile> | null = null;
let usageRequest: Promise<PlanUsage> | null = null;
let billingRequest: Promise<BillingHistoryItem[]> | null = null;

function loadProfile() {
  if (profileCache && Date.now() - profileCache.fetchedAt < SETTINGS_CACHE_MS) return Promise.resolve(profileCache.value);
  if (!profileRequest) {
    profileRequest = getUserProfile()
      .then((value) => { profileCache = { value, fetchedAt: Date.now() }; return value; })
      .finally(() => { profileRequest = null; });
  }
  return profileRequest;
}

function loadUsage() {
  if (usageCache && Date.now() - usageCache.fetchedAt < SETTINGS_CACHE_MS) return Promise.resolve(usageCache.value);
  if (!usageRequest) {
    usageRequest = getPlanUsage()
      .then((value) => { usageCache = { value, fetchedAt: Date.now() }; return value; })
      .finally(() => { usageRequest = null; });
  }
  return usageRequest;
}

function loadBilling() {
  if (billingCache && Date.now() - billingCache.fetchedAt < SETTINGS_CACHE_MS) return Promise.resolve(billingCache.value);
  if (!billingRequest) {
    billingRequest = getBillingHistory()
      .then((value) => { billingCache = { value, fetchedAt: Date.now() }; return value; })
      .finally(() => { billingRequest = null; });
  }
  return billingRequest;
}

const sections: { name: Section; icon: typeof LayoutGrid; keywords: string }[] = [
  { name: "Overview", icon: LayoutGrid, keywords: "home summary status" },
  { name: "Usage", icon: BarChart3, keywords: "quota runs limits activity" },
  { name: "Plan & billing", icon: CreditCard, keywords: "subscription payment invoice price" },
  { name: "Account", icon: UserCircle, keywords: "profile name email github" },
  { name: "Connections", icon: Github, keywords: "github repositories integration" },
];

function disconnectGithub() {
  clearAuth();
  window.location.replace("/");
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);
}

export default function Settings() {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<Section>("Overview");
  const [profile, setProfile] = useState<QuillProfile | null>(() => profileCache?.value ?? null);
  const [usage, setUsage] = useState<PlanUsage | null>(() => usageCache?.value ?? null);
  const [billing, setBilling] = useState<BillingHistoryItem[]>(() => billingCache?.value ?? []);
  const [profileLoading, setProfileLoading] = useState(() => !profileCache);
  const [usageLoading, setUsageLoading] = useState(() => !usageCache);
  const [billingLoading, setBillingLoading] = useState(() => !billingCache);
  const [loadError, setLoadError] = useState("");
  const [checkout, setCheckout] = useState<{ plan: "basic" | "pro"; order: RazorpayOrder } | null>(null);
  const [purchaseLoading, setPurchaseLoading] = useState<"basic" | "pro" | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const githubConnected = isLoggedIn();
  const filteredSections = useMemo(() => sections.filter(({ name, keywords }) => `${name} ${keywords}`.toLowerCase().includes(search.trim().toLowerCase())), [search]);

  useEffect(() => {
    let mounted = true;
    // Overview only needs account and usage. Keep those requests independent so
    // a slow GitHub profile refresh never blocks the plan/run summary.
    void loadProfile().then((value) => { if (mounted) setProfile(value); })
      .catch(() => { if (mounted && !profileCache) setLoadError("Could not load account details. Please try again."); })
      .finally(() => { if (mounted) setProfileLoading(false); });
    void loadUsage().then((value) => { if (mounted) setUsage(value); })
      .catch(() => { if (mounted && !usageCache) setLoadError("Could not load account details. Please try again."); })
      .finally(() => { if (mounted) setUsageLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (section !== "Plan & billing") return;
    let mounted = true;
    setBillingLoading(!billingCache);
    void loadBilling().then((value) => { if (mounted) setBilling(value); })
      .catch(() => { if (mounted) setLoadError("Could not load billing history. Please try again."); })
      .finally(() => { if (mounted) setBillingLoading(false); });
    return () => { mounted = false; };
  }, [section]);

  const chooseSection = (next: Section) => setSection(next);
  const periodEnd = usage?.periodEnd ? formatDate(usage.periodEnd) : null;
  const usagePercent = usage?.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  const planName = usage?.plan
    ? usage.plan === "free" ? "Free" : usage.plan === "basic" ? "Basic" : "Pro"
    : "No active plan";

  const beginPlanPurchase = async (plan: "basic" | "pro") => {
    setPaymentError("");
    setPaymentNotice("");
    setPurchaseLoading(plan);
    try {
      const order = await createRazorpayOrder(plan);
      setCheckout({ plan, order });
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Unable to start Razorpay checkout.");
    } finally {
      setPurchaseLoading(null);
    }
  };

  const completePlanPurchase = async (result: unknown) => {
    const verification = result as { verified?: boolean; usage?: PlanUsage };
    const freshUsage = verification.usage ?? await getPlanUsage();
    usageCache = { value: freshUsage, fetchedAt: Date.now() };
    setUsage(freshUsage);
    setCheckout(null);
    setPaymentError("");
    setPaymentNotice(`Payment verified. Your ${freshUsage.plan === "pro" ? "Pro" : "Basic"} plan is active.`);

    billingCache = null;
    try {
      const freshBilling = await getBillingHistory();
      billingCache = { value: freshBilling, fetchedAt: Date.now() };
      setBilling(freshBilling);
    } catch {
      // Payment and plan activation are already confirmed; history can refresh on next visit.
    }
  };

  const renderPlanPurchaseAction = (plan: "basic" | "pro", label: string) => {
    if (checkout?.plan === plan) {
      return <RazorpayCheckout
        order={checkout.order}
        user={{ name: profile?.name, email: profile?.email }}
        verifyPayment={verifyRazorpayPayment}
        onSuccess={completePlanPurchase}
        onError={(error) => { setCheckout(null); setPaymentError(error.message); }}
        onDismiss={() => setCheckout(null)}
        autoOpen
        className="btn btn-quiet settings-primary-link"
      />;
    }
    return <button
      type="button"
      className="btn btn-quiet settings-primary-link"
      onClick={() => void beginPlanPurchase(plan)}
      disabled={purchaseLoading !== null || checkout !== null}
    >
      {purchaseLoading === plan ? "Preparing checkout…" : <>{label} <ArrowRight size={15} /></>}
    </button>;
  };

  const sectionContent = () => {
    if (section === "Connections") {
      return <div className="settings-card">
        <div className="settings-card-heading">
          <div className="settings-provider-icon github-mark" aria-hidden="true"><Github size={23} /></div>
          <div><h2>GitHub</h2><p>Repositories and pull requests</p></div>
          <span className={`connection-status${githubConnected ? " connected" : ""}`}><i />{githubConnected ? "Connected" : "Not connected"}</span>
        </div>
        <div className="settings-card-body">
          <p>{githubConnected ? "Quill can access the repositories granted to your GitHub App installation." : "Connect your GitHub account to choose repositories and work on them with Quill."}</p>
          <div className="settings-connection-actions">
            <a className="btn btn-quiet settings-manage-link" href={getManageInstallUrl()} target="_blank" rel="noreferrer">{githubConnected ? "Manage repository access" : "Connect GitHub"}<ExternalLink size={15} /></a>
            {githubConnected && <button className="btn btn-quiet settings-disconnect" type="button" onClick={disconnectGithub}>Disconnect GitHub</button>}
          </div>
        </div>
      </div>;
    }

    if (section === "Overview") {
      return <>
        <div className="settings-overview-grid">
          <article className="settings-summary-card"><span>Current plan</span><strong>{usageLoading ? "Loading…" : planName}</strong><button type="button" onClick={() => chooseSection("Plan & billing")}>View plan <ArrowRight size={14} /></button></article>
          <article className="settings-summary-card"><span>Credits remaining</span><strong>{usageLoading ? "Loading…" : usage?.active ? `${usage.remaining} / ${usage.limit}` : "—"}</strong><button type="button" onClick={() => chooseSection("Usage")}>View usage <ArrowRight size={14} /></button></article>
          <article className="settings-summary-card"><span>GitHub connection</span><strong className="settings-connection-value"><i className={githubConnected ? "is-connected" : ""} />{githubConnected ? "Connected" : "Not connected"}</strong><button type="button" onClick={() => chooseSection("Connections")}>Manage connection <ArrowRight size={14} /></button></article>
        </div>
        <h2 className="settings-section-heading">Account overview</h2>
        <div className="settings-card settings-card-body settings-overview-account">
          <div><span className="settings-overview-name">{profile?.name || profile?.login || "Your Quill account"}</span><p>{profile?.email || "Your account and workspace details at a glance."}</p></div>
          <button type="button" className="btn btn-quiet" onClick={() => chooseSection("Account")}>View account <ArrowRight size={14} /></button>
        </div>
        {loadError && <p role="alert" className="profile-error">{loadError}</p>}
      </>;
    }

    if (section === "Usage") {
      return <>
        <div className="settings-card settings-usage-card">
          <div className="settings-card-body">
            <div className="settings-usage-heading"><div><h2>{usage?.active ? usage.plan === "free" ? "Free trial usage" : `${planName} plan usage` : "No active plan"}</h2><p>{usage?.active && periodEnd ? `Current period ends ${periodEnd}` : usage?.plan === "free" ? "Your five free credits are a one-time trial." : "Choose a plan to get credits."}</p></div><strong>{usage?.active ? `${usage.used} / ${usage.limit}` : "—"}</strong></div>
            {usage?.active && <><div className="settings-usage-track" role="progressbar" aria-label="Credit usage" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.used}><span style={{ width: `${usagePercent}%` }} /></div><div className="settings-usage-foot"><span>{usage.remaining} credits remaining</span><span>{usagePercent}% used</span></div></>}
          </div>
        </div>
        <p className="settings-helper-copy">Each session starts at 1 credit. Every 2 main-chat follow-ups add 1 credit. Internal model and tool calls don’t count. {usage?.plan === "free" ? "The free trial includes five credits total." : "Paid plan credits reset with each 30-day period."}</p>
        {usage?.active && usage.remaining === 0 && <a className="btn btn-quiet settings-primary-link" href="/#pricing">Choose a plan and pay manually to add credits <ArrowRight size={15} /></a>}
        {!usage?.active && <a className="btn btn-quiet settings-primary-link" href="/#pricing">Explore plans <ArrowRight size={15} /></a>}
        {loadError && <p role="alert" className="profile-error">{loadError}</p>}
      </>;
    }

    if (section === "Plan & billing") {
      return <>
        <div className="settings-card">
          <div className="settings-card-heading"><div className="settings-provider-icon"><CreditCard size={20} /></div><div><h2>{planName}</h2><p>{usage?.plan === "free" ? "Free trial access" : usage?.active ? "Active subscription" : "Subscription and payment details"}</p></div><span className={`settings-plan-status${usage?.active && usage.plan !== "free" ? " active" : ""}`}>{usage?.plan === "free" ? "Free" : usage?.active ? "Active" : "No active plan"}</span></div>
          <div className="settings-card-body settings-billing-summary">
            {usage?.plan === "free"
              ? <><p>Your free trial includes five credits total. Choose a paid plan when you’re ready to add credits.</p><div className="settings-plan-options">{renderPlanPurchaseAction("basic", "Choose Basic · ₹799")}{renderPlanPurchaseAction("pro", "Choose Pro · ₹1,599")}</div></>
              : usage?.active
                ? <><p>Your {planName} plan includes {usage.limit} credits for this 30-day period.</p><div className="settings-billing-meta"><span>Period ends</span><strong>{periodEnd}</strong></div><p className="settings-helper-copy settings-billing-cycle-note">This is a one-time payment plan. Renew manually when you’re ready for another period.</p>{usage.plan === "basic" && <><p className="settings-helper-copy">Upgrading starts a new Pro period. Any unused Basic credits won’t carry over.</p>{renderPlanPurchaseAction("pro", "Upgrade your subscription to the Pro plan")}</>}</>
                : <><p>You don’t have an active plan yet. Choose a plan to unlock credits and repository work.</p><a className="btn btn-quiet settings-primary-link" href="/#pricing">View plans <ArrowRight size={15} /></a></>}
          </div>
          {(paymentError || paymentNotice) && <div className="settings-card-body">{paymentError && <p role="alert" className="profile-error">{paymentError}</p>}{paymentNotice && <p role="status" className="settings-helper-copy">{paymentNotice}</p>}</div>}
        </div>
        <h2 className="settings-section-heading">Payment history</h2>
        <div className="settings-card settings-history-card">
          {billing.length ? billing.map((item) => <div className="settings-history-row" key={item.id}><div><strong>{item.plan === "pro" ? "Pro" : "Basic"} plan</strong><span>{formatDate(item.createdAt)}</span></div><div className="settings-history-amount"><strong>{formatMoney(item.priceMinorUnits, item.currency)}</strong><span className={`settings-history-status status-${item.status}`}>{item.status.replaceAll("_", " ")}</span></div></div>) : <div className="settings-history-empty">{billingLoading ? "Loading payment history…" : "Payments and subscription updates will appear here."}</div>}
        </div>
        {loadError && <p role="alert" className="profile-error">{loadError}</p>}
      </>;
    }

    return <>
      <div className="settings-card profile-card">
        <div className="settings-profile-heading"><div className="profile-avatar">{profile?.name?.slice(0, 1).toUpperCase() || profile?.login?.slice(0, 1).toUpperCase() || <UserCircle size={20} />}</div><div><h2>{profile?.name || "Your account"}</h2><p>{profile?.login ? `@${profile.login}` : "Signed in with GitHub"}</p></div></div>
        <div className="settings-account-row"><span>Name</span><strong>{profileLoading ? "Loading…" : profile?.name || "Not provided"}</strong></div>
        <div className="settings-account-row"><span>GitHub username</span><strong>{profileLoading ? "Loading…" : profile?.login ? `@${profile.login}` : "Unavailable"}</strong></div>
      </div>
      {loadError && <p role="alert" className="profile-error">{loadError}</p>}
    </>;
  };

  const description: Record<Section, string> = {
    Overview: "A quick view of your Quill account and workspace.",
    Usage: "Track credits included in your current plan.",
    "Plan & billing": "Manage your plan and review payment activity.",
    Account: "Your profile details from the GitHub account connected to Quill.",
    Connections: "Manage the services connected to your Quill workspace.",
  };

  return (
    <section className="settings-page">
      <aside className="settings-nav">
        <label className="settings-search"><Search size={16} /><input aria-label="Search settings" placeholder="Search settings..." value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>/</kbd></label>
        <p className="settings-nav-caption">Workspace</p>
        <nav aria-label="Settings sections">
          {filteredSections.filter((item) => ["Overview", "Usage", "Plan & billing"].includes(item.name)).map(({ name, icon: Icon }) => <button key={name} className={`settings-nav-item${section === name ? " active" : ""}`} type="button" onClick={() => chooseSection(name)}><Icon size={17} /><span>{name}</span></button>)}
          <p className="settings-nav-caption settings-nav-subcaption">Personal</p>
          {filteredSections.filter((item) => ["Account", "Connections"].includes(item.name)).map(({ name, icon: Icon }) => <button key={name} className={`settings-nav-item${section === name ? " active" : ""}`} type="button" onClick={() => chooseSection(name)}><Icon size={17} /><span>{name}</span></button>)}
          {!filteredSections.length && <p className="settings-empty-search">No matching settings</p>}
        </nav>
      </aside>

      <div className="settings-content">
        <header className="settings-heading"><div><h1>{section}</h1><p className="muted">{description[section]}</p></div></header>
        {sectionContent()}
      </div>
    </section>
  );
}
