import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Activity,
  Check,
  Code2,
  Files,
  GitBranch,
  Github,
  GitPullRequest,
  Layers3,
  MessageCircle,
  Plus,
  Play,
  Settings2,
  Sparkles,
  Terminal,
  MessageSquareText,
  Bug,
  WandSparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "@/lib/router";
import {
  createRazorpayOrder,
  getLoginUrl,
  isLoggedIn,
  verifyRazorpayPayment,
} from "@/lib/api";
import { SiteFooter } from "@/components/Footer";
import { QuillMark } from "@/components/QuillMark";
import { RazorpayCheckout } from "@/components/RazorpayCheckout";
import "./LandingPage.css";
import "./PricingPage.css";

export function LandingPage() {
  const [razorpayOrder, setRazorpayOrder] = useState<Awaited<ReturnType<typeof createRazorpayOrder>> | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "pro" | null>(null);
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => {
    if (window.location.hash.startsWith("#pricing")) {
      const pricingTarget = window.location.hash === "#pricing"
        ? "pricing"
        : window.location.hash.slice(1);
      requestAnimationFrame(() => {
        document.getElementById(pricingTarget)?.scrollIntoView({ block: "start" });
      });
    }

    const revealTargets = document.querySelectorAll<HTMLElement>(
      ".quill-home [data-scroll-reveal]",
    );

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      revealTargets.forEach((target) => target.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -24px 0px" },
    );

    revealTargets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  const enterQuill = () => {
    if (isLoggedIn()) navigate({ page: "dashboard" });
    else window.location.href = getLoginUrl();
  };

  const startPayment = async (plan: "basic" | "pro") => {
    setPaymentError("");
    if (!isLoggedIn()) {
      setPaymentError("Sign in with GitHub before subscribing so we can activate the plan on your account.");
      return;
    }
    setSelectedPlan(plan);
    try {
      setRazorpayOrder(await createRazorpayOrder(plan));
    } catch (error) {
      setSelectedPlan(null);
      setPaymentError(error instanceof Error ? error.message : "Unable to start payment.");
    }
  };

  return (
    <main className="quill-home">
      <div className="home-orb home-orb-a" aria-hidden="true" />
      <div className="home-orb home-orb-b" aria-hidden="true" />
      <nav className="home-nav">
        <a className="home-brand" href="/" aria-label="quill beta home">
          <span className="home-brand-mark">
            <QuillMark size={19} />
          </span>
          <span>quill</span>
          <span className="home-beta-tag">Beta</span>
        </a>
        <div className="home-nav-links">
          <a href="#workflow">How it works</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="home-nav-actions">
          <button className="home-signin" onClick={enterQuill}>
            {isLoggedIn() ? "Open dashboard" : "Sign in"}
          </button>
          <button className="home-nav-cta" onClick={enterQuill}>
            Get started <ArrowUpRight size={15} />
          </button>
        </div>
      </nav>

      <section className="home-hero">
        <div className="hero-copy" data-scroll-reveal>
          <div className="hero-badge">
            <span className="badge-spark">
              <Sparkles size={13} />
            </span>{" "}
            Your coding agent, ready to work
          </div>
          <h1>
            Good ideas deserve
            <br />
            to <span>ship.</span>
          </h1>
          <p className="hero-description">
            Give Quill a task. It opens your repository in a cloud workspace,
            figures out the code, and gets to work—with you in the loop.
          </p>
          <div className="hero-actions">
            <button className="home-primary-cta" onClick={enterQuill}>
              <Github size={18} /> Continue with GitHub <ArrowRight size={16} />
            </button>
            <a href="#workflow" className="home-text-cta">
              See how it works <ArrowDown size={15} />
            </a>
          </div>
          <div className="hero-reassurance">
            <span>
              <Check size={14} /> Your repositories stay yours
            </span>
            <i /> <span>No setup to get started</span>
          </div>
        </div>

        <div
          className="hero-visual"
          data-scroll-reveal
          data-reveal-delay="1"
          aria-label="Preview of a Quill coding session"
        >
          <div className="preview-glow" />
          <div className="session-window">
            <div className="window-body">
              <aside className="window-app-sidebar">
                <div className="window-app-brand">
                  <span className="mini-mark">
                    <QuillMark size={11} />
                  </span>
                  quill
                </div>
                <div className="window-action">
                  <Plus size={12} /> New session
                </div>
                <div className="window-action">
                  <GitPullRequest size={12} /> Review
                </div>
                <div className="window-sidebar-sessions-label">Sessions</div>
                <div className="window-session-list">
                  <div className="window-session-item selected">
                    <i className="session-status-dot done" />
                    <span>
                      <strong>Fix cache expiry bug</strong>
                      <small>acme/redis-client</small>
                    </span>
                  </div>
                  <div className="window-session-item">
                    <i className="session-status-dot done" />
                    <span>
                      <strong>Add TTL regression test</strong>
                      <small>acme/redis-client</small>
                    </span>
                  </div>
                </div>
                <div className="window-settings">
                  <Settings2 size={12} /> Settings
                </div>
              </aside>
              <div className="window-main">
                <header className="window-session-header">
                  <div className="window-session-heading">
                    <ArrowLeft size={13} />
                    <span>
                      <strong>Fix cache expiry bug</strong>
                      <small>acme/redis-client</small>
                    </span>
                    <span className="window-state-pill"><i /> PR ready</span>
                  </div>
                </header>
                <div className="window-chat">
                  <div className="user-bubble">
                    Fix the Redis cache expiry bug, add a regression test, and open a PR.
                  </div>
                  <div className="agent-line">
                    <span className="agent-avatar">
                      <Sparkles size={12} />
                    </span>
                    <div>
                      <strong>quill</strong>
                      <p>
                        The expiry time was calculated but not applied on writes. I fixed the store call and added a regression test.
                      </p>
                    </div>
                  </div>
                  <div className="work-card">
                    <div className="work-card-head">
                      <span className="work-pulse" />
                      Updated <code>cache/client.go</code>
                    </div>
                    <div className="code-lines">
                      <span><b>35</b> expiresAt := time.Now().Add(ttl)</span>
                      <span className="added"><b>36</b> return c.store.Set(key, value, expiresAt)</span>
                    </div>
                  </div>
                  <div className="agent-line final-agent">
                    <span className="agent-avatar done"><Check size={12} /></span>
                    <p>Tests passed <span className="preview-commit">· commit 8d3a1f pushed</span></p>
                  </div>
                  <div className="preview-pr-card">
                    <GitBranch size={12} />
                    <span><strong>PR #42 opened</strong><small>fix/cache-expiry → main</small></span>
                    <ArrowUpRight size={12} />
                  </div>
                  <div className="window-activity">Activity · 6 steps · just now</div>
                  <div className="window-chat-spacer" />
                  <div className="window-composer">
                    <span className="composer-placeholder">Ask Quill a question or describe a change</span>
                    <div className="composer-footer">
                      <small>Ask a follow-up…</small>
                      <span className="composer-send"><ArrowUp size={13} /></span>
                    </div>
                  </div>
                </div>
              </div>
              <aside className="window-tools">
                <div className="window-tool-link">
                  <Files size={13} />
                  <span><strong>Files</strong><small>Browse the session workspace</small></span>
                </div>
                <div className="window-tool-link">
                  <GitBranch size={13} />
                  <span><strong>Changes</strong><small>See the agent’s file edits</small></span>
                </div>
                <div className="window-tool-link">
                  <Terminal size={13} />
                  <span><strong>Terminal</strong><small>Commands and output</small></span>
                </div>
                <div className="window-tool-link">
                  <MessageCircle size={13} />
                  <span><strong>Side chat</strong><small>Ask a follow-up question</small></span>
                </div>
                <div className="window-tool-link">
                  <Activity size={13} />
                  <span><strong>Progress</strong><small>Understand the agent’s work</small></span>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <section className="home-workflow" id="workflow">
        <div className="section-intro" data-scroll-reveal>
          <span className="section-kicker">A better way to build</span>
          <h2>
            From “what if” to
            <br />
            <span>ready for review.</span>
          </h2>
          <p>
            Quill handles the busywork while you stay close to every decision.
          </p>
        </div>
        <div className="workflow-steps">
          <article className="workflow-step" data-scroll-reveal data-reveal-delay="1">
            <div className="step-number">01</div>
            <div className="step-icon">
              <GitBranch size={19} />
            </div>
            <h3>Choose your repo</h3>
            <p>
              Connect GitHub and pick a repository. Quill gets a clean, isolated
              workspace ready.
            </p>
            <span className="step-link">
              Your code, safely checked out <Check size={14} />
            </span>
          </article>
          <article className="workflow-step" data-scroll-reveal data-reveal-delay="2">
            <div className="step-number">02</div>
            <div className="step-icon">
              <Sparkles size={19} />
            </div>
            <h3>Describe the work</h3>
            <p>
              Ask a question, report a bug, or describe a feature. Quill can
              chat first or jump into code.
            </p>
            <span className="step-link">
              You stay in control <Check size={14} />
            </span>
          </article>
          <article className="workflow-step" data-scroll-reveal data-reveal-delay="3">
            <div className="step-number">03</div>
            <div className="step-icon">
              <Layers3 size={19} />
            </div>
            <h3>Review the result</h3>
            <p>
              Follow progress, inspect the changes, and open a pull request when
              you’re ready.
            </p>
            <span className="step-link">
              Nothing ships without you <Check size={14} />
            </span>
          </article>
        </div>
      </section>

      <section className="home-usecases">
        <div className="usecases-heading" data-scroll-reveal>
          <span className="section-kicker">Start wherever you are</span>
          <h2>
            Sometimes you need an answer.
            <br />
            <span>Sometimes you need a teammate.</span>
          </h2>
          <p>
            Quill meets the task where it is. Ask naturally, get a direct
            answer, or hand over a change when you’re ready.
          </p>
        </div>
        <div className="usecase-grid">
          <article className="usecase-card" data-scroll-reveal data-reveal-delay="1">
            <span className="usecase-icon">
              <MessageSquareText size={20} />
            </span>
            <span className="usecase-label">UNDERSTAND</span>
            <h3>Ask about your code</h3>
            <p>
              “Where is the cache configured?” Get a clear explanation based on
              your repository, without unnecessary tool runs.
            </p>
            <div className="usecase-example">
              <span className="example-user">
                How does this service handle retries?
              </span>
              <span className="example-answer">
                <Sparkles size={13} /> Quill explains the retry flow and points
                you to the relevant files.
              </span>
            </div>
          </article>
          <article className="usecase-card" data-scroll-reveal data-reveal-delay="2">
            <span className="usecase-icon">
              <Bug size={20} />
            </span>
            <span className="usecase-label">FIX</span>
            <h3>Hand off a bug</h3>
            <p>
              Share the symptoms and let Quill trace the issue, make a focused
              change, and verify the fix.
            </p>
            <div className="usecase-example">
              <span className="example-user">
                Fix the expiry bug in the Redis client.
              </span>
              <span className="example-answer">
                <Check size={13} /> Change made · regression test passes
              </span>
            </div>
          </article>
          <article className="usecase-card" data-scroll-reveal data-reveal-delay="3">
            <span className="usecase-icon">
              <WandSparkles size={20} />
            </span>
            <span className="usecase-label">BUILD</span>
            <h3>Shape the next idea</h3>
            <p>
              Describe a feature in plain language. Work through the details
              together and review each change.
            </p>
            <div className="usecase-example">
              <span className="example-user">Add a health check endpoint.</span>
              <span className="example-answer">
                <GitBranch size={13} /> Ready for your review
              </span>
            </div>
          </article>
        </div>
      </section>

      <section className="home-features" id="features">
        <div className="features-heading" data-scroll-reveal>
          <span className="section-kicker">Made for your flow</span>
          <h2>
            A capable agent.
            <br />
            <span>A workspace you can trust.</span>
          </h2>
          <p>
            From first question to final review, your work stays visible and in
            your hands.
          </p>
        </div>
        <div className="feature-grid">
          <article data-scroll-reveal data-reveal-delay="1">
            <div className="feature-icon">
              <Code2 size={18} />
            </div>
            <h3>Grounded in your repository</h3>
            <p>
              Quill works with the files and project context you selected, so
              answers and edits relate to your actual code.
            </p>
          </article>
          <article data-scroll-reveal data-reveal-delay="2">
            <div className="feature-icon">
              <Terminal size={18} />
            </div>
            <h3>A sandbox for every task</h3>
            <p>
              Build and run the project in an isolated environment with a
              terminal and app preview alongside the conversation.
            </p>
          </article>
          <article data-scroll-reveal data-reveal-delay="3">
            <div className="feature-icon">
              <GitBranch size={18} />
            </div>
            <h3>Review before it ships</h3>
            <p>
              Follow the work, inspect the diff, ask for changes, and decide
              when it’s ready to become a pull request.
            </p>
          </article>
        </div>
      </section>

      <section className="pricing-content" id="pricing">
        <div className="pricing-heading" data-scroll-reveal>
          <span className="section-kicker">
            <Sparkles size={13} /> Simple plans, more room to build
          </span>
          <h2>
            Choose your pace.
            <br />
            <span>Keep your work moving.</span>
          </h2>
        </div>
        <div className="pricing-cards">
          <article className="pricing-card" data-scroll-reveal>
            <div className="pricing-plan-name">Free</div>
            <p className="pricing-plan-description">
              Try Quill on a real repository before choosing a paid plan.
            </p>
            <div className="pricing-price">
              <span className="pricing-currency">₹</span>0
              <span className="pricing-period">/ free trial</span>
            </div>
            <div className="pricing-price-note">
              No payment required · 5 credits total
            </div>
            <div className="pricing-divider" />
            <ul>
              <li><Check size={15} />5 credits to try Quill</li>
              <li><Check size={15} />Repository questions and code changes</li>
              <li><Check size={15} />Reviewable workspace changes</li>
            </ul>
            <button type="button" className="pricing-button" onClick={enterQuill}>
              Try Quill free <ArrowRight size={15} />
            </button>
          </article>
          <article className="pricing-card" id="pricing-basic" data-scroll-reveal data-reveal-delay="1">
            <div className="pricing-plan-name">Basic</div>
            <p className="pricing-plan-description">
              For everyday repository questions and focused coding tasks.
            </p>
            <div className="pricing-price">
                <span className="pricing-currency">₹</span>799
              <span className="pricing-period">/ 30 days</span>
            </div>
            <div className="pricing-price-note">
              One-time payment · renew manually
            </div>
            <div className="pricing-divider" />
            <ul>
              <li>
                <Check size={15} />
                50 credits per 30 days
              </li>
              <li>
                <Check size={15} />
                Core coding models
              </li>
              <li>
                <Check size={15} />
                Repository questions and code changes
              </li>
              <li>
                <Check size={15} />
                Reviewable workspace changes
              </li>
            </ul>
            {razorpayOrder && selectedPlan === "basic" ? (
              <RazorpayCheckout
                order={razorpayOrder}
                verifyPayment={verifyRazorpayPayment}
                onError={(error) => setPaymentError(error.message)}
                onSuccess={() => {
                  setRazorpayOrder(null);
                  setSelectedPlan(null);
                  navigate({ page: "dashboard" });
                }}
                autoOpen
                className="pricing-button"
              />
            ) : (
              <button type="button" className="pricing-button" onClick={() => startPayment("basic")}>
                Subscribe <ArrowRight size={15} />
              </button>
            )}
          </article>
          <article className="pricing-card pricing-card-featured" id="pricing-pro" data-scroll-reveal data-reveal-delay="2">
            <div className="pricing-popular">MORE CAPACITY</div>
            <div className="pricing-plan-name">Pro</div>
            <p className="pricing-plan-description">
              For heavier use, bigger projects, and more demanding work.
            </p>
            <div className="pricing-price">
              <span className="pricing-currency">₹</span>1,599
              <span className="pricing-period">/ 30 days</span>
            </div>
            <div className="pricing-price-note">
              One-time payment · renew manually
            </div>
            <div className="pricing-divider" />
            <ul>
              <li>
                <Check size={15} />
                Everything in Basic
              </li>
              <li>
                <Check size={15} />
                100 credits per 30 days
              </li>
            </ul>
            {razorpayOrder && selectedPlan === "pro" ? (
              <RazorpayCheckout
                order={razorpayOrder}
                verifyPayment={verifyRazorpayPayment}
                onError={(error) => setPaymentError(error.message)}
                onSuccess={() => {
                  setRazorpayOrder(null);
                  setSelectedPlan(null);
                  navigate({ page: "dashboard" });
                }}
                autoOpen
                className="pricing-button pricing-button-featured"
              />
            ) : (
              <button
                type="button"
                className="pricing-button pricing-button-featured"
                onClick={() => startPayment("pro")}
              >
                Subscribe <ArrowRight size={15} />
              </button>
            )}
          </article>
        </div>
        {paymentError && <p role="alert" className="pricing-footnote">{paymentError}</p>}
        <p className="pricing-footnote">
          Your payment is processed securely by Razorpay. Quill never receives
          or stores your card details.
        </p>
      </section>

      <section className="home-faq" id="faq">
        <div className="faq-intro" data-scroll-reveal>
          <span className="section-kicker">A few useful details</span>
          <h2>Good to know.</h2>
          <p>
            Quill is designed to make repository work feel straightforward and
            transparent.
          </p>
        </div>
        <div className="faq-list" data-scroll-reveal data-reveal-delay="1">
          <details>
            <summary>
              Can I ask Quill a question without asking it to change code?
              <span>+</span>
            </summary>
            <p>
              Yes. Ask about the repository or how something works. Quill can
              respond directly, then you can choose whether to ask it to make a
              change.
            </p>
          </details>
          <details>
            <summary>
              Does Quill work on my repository automatically?<span>+</span>
            </summary>
            <p>
              Quill only lists repositories you have granted to its GitHub App.
              Choose the repository for a session before describing the task.
            </p>
          </details>
          <details>
            <summary>
              Do I get to review the changes?<span>+</span>
            </summary>
            <p>
              Yes. You can follow the session, inspect file changes, and decide
              when to create a pull request.
            </p>
          </details>
        </div>
      </section>

      <section className="home-final-cta" data-scroll-reveal>
        <div className="final-cta-icon">
          <Play size={17} fill="currentColor" />
        </div>
        <div>
          <span className="section-kicker">
            Your next task is a good place to start
          </span>
          <h2>Let’s make something better.</h2>
        </div>
        <button className="home-primary-cta" onClick={enterQuill}>
          Start with Quill <ArrowRight size={16} />
        </button>
      </section>
      <SiteFooter />
    </main>
  );
}
