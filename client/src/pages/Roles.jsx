import { useState } from "react";
import { Plus, ShieldCheck, LockKeyhole, Pencil, Trash2 } from "lucide-react";
import { api } from "../api/client";
import {
  useResource,
  PageHeader,
  ErrorBanner,
  Success,
  Loading,
  Empty,
  Modal,
  Field,
  Submit,
  Badge,
} from "../components/UI";
function RoleForm({ record, catalog, close, done }) {
  const [scope, setScope] = useState(record?.scope || "self");
  const [permissions, setPermissions] = useState(record?.permissions || []);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const body = { name: values.name, permissions };
    if (record) body.isActive = values.isActive === "active";
    else Object.assign(body, { key: values.key, scope });
    setBusy(true);
    setError(null);
    try {
      await api(`/roles${record ? `/${record._id}` : ""}`, {
        method: record ? "PATCH" : "POST",
        body,
      });
      done();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="editor-form" onSubmit={submit}>
      <ErrorBanner error={error} />
      <div className="form-grid">
        <Field
          label="Role name"
          name="name"
          defaultValue={record?.name}
          required
          minLength={2}
          maxLength={60}
        />
        {!record && (
          <Field
            label="Role key"
            name="key"
            required
            minLength={2}
            maxLength={40}
            hint="Lowercase letters, numbers and underscores."
          />
        )}
        <Field
          label="Scope"
          value={scope}
          disabled={!!record}
          onChange={(e) => {
            setScope(e.target.value);
            setPermissions([]);
          }}
        >
          <option value="self">Own account</option>
          <option value="hotel">Assigned hotel</option>
          {record?.scope === "system" && <option value="system">System</option>}
        </Field>
        {record && (
          <Field
            label="Status"
            name="isActive"
            defaultValue={record.isActive ? "active" : "inactive"}
          >
            <option value="active">Active</option>
            {record.key !== "admin" && (
              <option value="inactive">Inactive</option>
            )}
          </Field>
        )}
      </div>
      <fieldset className="permissions-fieldset">
        <legend>Permissions</legend>
        <p>Home and own-profile access are available to every active role.</p>
        {catalog
          .filter((c) => c.scope === scope)
          .map((c) => (
            <label className="permission-option" key={c.key}>
              <input
                type="checkbox"
                checked={permissions.includes(c.key)}
                disabled={record?.key === "admin"}
                onChange={(e) =>
                  setPermissions((p) =>
                    e.target.checked
                      ? [...p, c.key]
                      : p.filter((k) => k !== c.key),
                  )
                }
              />
              <span>
                {c.name}
                <small>
                  {c.scope === "hotel"
                    ? "Only within the assigned hotel"
                    : "Across the system"}
                </small>
              </span>
            </label>
          ))}
        {scope === "self" && (
          <p className="field-note">
            This role can view Home and manage its own profile. It has no
            administrative access.
          </p>
        )}
      </fieldset>
      <div className="form-footer">
        <button className="button secondary" type="button" onClick={close}>
          Cancel
        </button>
        <Submit busy={busy}>
          {record ? "Save permissions" : "Create role"}
        </Submit>
      </div>
    </form>
  );
}
export default function Roles() {
  const list = useResource("/roles");
  const [editor, setEditor] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/roles/${removing._id}`, { method: "DELETE", body: {} });
      setRemoving(null);
      setMessage("Role deleted.");
      list.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION / ACCESS"
        title="A place for every role."
        description="Give people exactly the access they need, with clear boundaries."
        action={
          <button className="button primary" onClick={() => setEditor({})}>
            <Plus size={17} />
            Create role
          </button>
        }
      />
      <Success message={message} />
      <ErrorBanner error={list.error} retry={list.reload} />
      <div className="access-note">
        <ShieldCheck size={24} />
        <div>
          <strong>Permissions follow the person.</strong>
          <p>
            Changes apply on the next request. Inactive roles cannot sign in.
            System roles remain in place for team integrations.
          </p>
        </div>
      </div>
      {list.loading ? (
        <Loading />
      ) : (
        <div className="role-list">
          {list.data?.map((role, i) => (
            <article className="role-row" key={role._id}>
              <div className="role-row-heading">
                <span className="role-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2>{role.name}</h2>
                  <p>
                    {role.scope === "hotel"
                      ? "Assigned hotel"
                      : role.scope === "system"
                        ? "System-wide access"
                        : "Own account only"}{" "}
                    {role.isSystem && (
                      <>
                        <span>·</span> System role
                      </>
                    )}
                  </p>
                </div>
                <Badge value={role.isActive ? "active" : "inactive"} />
              </div>
              <div className="role-permissions">
                {role.permissions.length ? (
                  role.permissions.map((p) => (
                    <span key={p}>
                      {list.meta.permissions.find((c) => c.key === p)?.name ||
                        p}
                    </span>
                  ))
                ) : (
                  <span>Home & own profile</span>
                )}
              </div>
              <div className="role-actions">
                <button
                  className="button secondary"
                  onClick={() => setEditor(role)}
                >
                  <Pencil size={15} />
                  Edit permissions
                </button>
                {!role.isSystem ? (
                  <button
                    className="icon-button danger-text"
                    aria-label={`Delete ${role.name}`}
                    onClick={() => {
                      setError(null);
                      setRemoving(role);
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                ) : (
                  <LockKeyhole
                    size={17}
                    className="muted-icon"
                    aria-label="System role"
                  />
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={editor?._id ? `Edit ${editor.name}` : "Create a role"}
      >
        {list.meta && (
          <RoleForm
            record={editor?._id ? editor : null}
            catalog={list.meta.permissions}
            close={() => setEditor(null)}
            done={() => {
              setEditor(null);
              setMessage("Role permissions saved.");
              list.reload();
            }}
          />
        )}
      </Modal>
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Delete role?"
      >
        <div className="editor-form">
          <p>
            Delete {removing?.name}? A role assigned to any account cannot be
            deleted.
          </p>
          <ErrorBanner error={error} />
          <div className="form-footer">
            <button
              className="button secondary"
              onClick={() => setRemoving(null)}
            >
              Cancel
            </button>
            <button className="button danger" disabled={busy} onClick={remove}>
              {busy ? "Deleting…" : "Delete role"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
