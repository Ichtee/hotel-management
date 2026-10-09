import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Check, KeyRound } from "lucide-react";
import { useAuth } from "../context/Auth";
import { api } from "../api/client";
import { ErrorBanner, Field, Submit, Success } from "../components/UI";
export default function AuthPage({ register = false }) {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (user) return <Navigate to="/" replace />;
  async function submit(e) {
    e.preventDefault();
    setError(null);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    if (register && values.password !== values.confirm) {
      setError(new Error("Passwords do not match."));
      return;
    }
    delete values.confirm;
    setBusy(true);
    try {
      if (register) {
        await api("/auth/register", { method: "POST", body: values });
        navigate("/login?registered=1");
      } else {
        await signIn(values);
        navigate("/");
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Link to="/login" className="brand">
          <span className="brand-mark">h.</span>
          <span>
            hotel desk<small>HOSPITALITY WORKSPACE</small>
          </span>
        </Link>
        <div className="auth-story-content">
          <p className="eyebrow">EVERY DETAIL MATTERS</p>
          <h1>
            Good stays.
            <br />
            <em>Great beginnings.</em>
          </h1>
          <p>A considered space for the people behind every memorable stay.</p>
          <div className="architectural-motif" aria-hidden="true">
            <div className="arch arch-one" />
            <div className="arch arch-two" />
            <div className="arch arch-three" />
            <span>THE ART OF HOSPITALITY</span>
          </div>
        </div>
        <div className="auth-story-footer">
          <span>PEOPLE. PLACES. POSSIBILITIES.</span>
          <ArrowUpRight size={19} />
        </div>
      </section>
      <main id="main-content" className="auth-form-panel">
        <div className="auth-form-wrap">
          <span className="auth-icon">
            <KeyRound size={22} />
          </span>
          <p className="eyebrow">
            {register ? "MAKE YOURSELF AT HOME" : "YOUR WORKSPACE AWAITS"}
          </p>
          <h2>{register ? "Create your account" : "Welcome back."}</h2>
          <p className="subheading">
            {register
              ? "A few details to begin your hotel experience."
              : "Sign in to pick up where you left off."}
          </p>
          <Success
            message={
              !register && params.has("registered")
                ? "Account created. Sign in to your new workspace."
                : null
            }
          />
          <ErrorBanner error={error} />
          <form onSubmit={submit} key={register ? "register" : "login"}>
            {register && (
              <>
                <Field
                  label="Full name"
                  name="fullName"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={50}
                />
                <Field
                  label="Username"
                  name="username"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={40}
                />
              </>
            )}
            <Field
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              maxLength={254}
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={register ? 10 : 1}
              maxLength={128}
              hint={
                register
                  ? "At least 10 characters, including a letter and a number."
                  : undefined
              }
            />
            {register && (
              <Field
                label="Confirm password"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
              />
            )}
            <Submit busy={busy}>
              {register ? "Create account" : "Sign in"}
            </Submit>
          </form>
          <p className="auth-switch">
            {register ? "Already have an account?" : "New to Hotel Desk?"}{" "}
            <Link
              to={register ? "/login" : "/register"}
              onClick={() => setError(null)}
            >
              {register ? "Sign in" : "Create an account"}{" "}
              <ArrowUpRight size={14} />
            </Link>
          </p>
          <div className="auth-trust">
            <Check size={15} />
            <span>Your workspace is protected with secure sign-in.</span>
          </div>
        </div>
        <footer>
          HOTEL MANAGEMENT SYSTEM <span>•</span> A place for every detail
        </footer>
      </main>
    </div>
  );
}
