import { useState } from "react";
import { useAuth } from "../context/Auth";
import { api, inputDate } from "../api/client";
import {
  PageHeader,
  Field,
  ErrorBanner,
  Success,
  Submit,
  Badge,
} from "../components/UI";
function PasswordForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const b = Object.fromEntries(new FormData(form));
    setSuccess("");
    setError(null);
    if (b.newPassword !== b.confirm)
      return setError(new Error("New passwords do not match."));
    delete b.confirm;
    setBusy(true);
    try {
      const r = await api("/profile/password", { method: "PUT", body: b });
      setSuccess(r.data.message);
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-section">
      <div className="section-intro">
        <p className="eyebrow">02 / SECURITY</p>
        <h2>A fresh password.</h2>
        <p>Changing your password signs out your other sessions.</p>
      </div>
      <form className="panel form-panel" onSubmit={submit}>
        <ErrorBanner error={error} />
        <Success message={success} />
        <Field
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
        <div className="form-grid">
          <Field
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            hint="10+ characters, with a letter and number."
          />
          <Field
            label="Confirm new password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
          />
        </div>
        <div className="form-footer">
          <Submit busy={busy}>Change password</Submit>
        </div>
      </form>
    </section>
  );
}
export default function Profile() {
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  async function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError(null);
    setSuccess("");
    try {
      await api("/profile", { method: "PATCH", body });
      await refresh();
      setSuccess("Profile updated.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="YOUR ACCOUNT"
        title="My profile"
        description="The details that make this workspace yours."
      />
      <section className="profile-section">
        <div className="section-intro">
          <p className="eyebrow">01 / PERSONAL DETAILS</p>
          <h2>Make yourself known.</h2>
          <p>
            Keep your contact information current so your hotel can reach you.
          </p>
          <div className="profile-identity">
            <span className="avatar large">
              {(user.customerProfile?.fullName || user.username).slice(0, 1)}
            </span>
            <strong>{user.username}</strong>
            <Badge value={user.roleName} />
            <small>{user.email}</small>
          </div>
        </div>
        <form className="panel form-panel" onSubmit={submit}>
          <ErrorBanner error={error} />
          <Success message={success} />
          <div className="form-grid">
            <Field
              label="Full name"
              name="fullName"
              defaultValue={user.customerProfile?.fullName}
              required
              minLength={2}
              maxLength={50}
              autoComplete="name"
            />
            <Field
              label="Phone number"
              name="phone"
              defaultValue={user.phone}
              pattern="[0-9]{10,11}"
              required={user.scope === "hotel"}
              autoComplete="tel"
              hint="10–11 digits, without spaces."
            />
            <Field
              label="Date of birth"
              name="dateOfBirth"
              type="date"
              defaultValue={inputDate(user.customerProfile?.dateOfBirth)}
              max={inputDate(new Date())}
            />
            <Field
              label="Address"
              name="address"
              defaultValue={user.customerProfile?.address}
              maxLength={250}
              autoComplete="street-address"
            />
          </div>
          <p className="field-note">
            Email, role and hotel assignment are managed by your administrator.
          </p>
          <div className="form-footer">
            <Submit busy={busy}>Save profile</Submit>
          </div>
        </form>
      </section>
      <PasswordForm />
    </>
  );
}
