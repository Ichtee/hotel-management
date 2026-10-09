import { useState } from "react";
import { Plus, Pencil, ArrowUpRight } from "lucide-react";
import { api, dateLabel, inputDate } from "../api/client";
import {
  useResource,
  PageHeader,
  ErrorBanner,
  Success,
  Loading,
  Empty,
  SearchToolbar,
  Pagination,
  Modal,
  Field,
  Submit,
  Badge,
} from "../components/UI";
function AccountForm({ record, staff, options, onDone, onClose }) {
  const [role, setRole] = useState(
    record?.role || (staff ? "receptionist" : "customer"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const hotelRole =
    options.roles.find((r) => r.key === role)?.scope === "hotel";
  const roleOptions = staff
    ? options.roles.filter((r) =>
        ["receptionist", "housekeeping"].includes(r.key),
      )
    : options.roles;
  async function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    if (!hotelRole)
      for (const key of ["hotelId", "position", "shift", "hireDate"])
        delete body[key];
    setBusy(true);
    setError(null);
    try {
      await api(
        `/${staff ? "staff" : "users"}${record ? `/${record._id}` : ""}`,
        { method: record ? "PATCH" : "POST", body },
      );
      onDone(
        record
          ? "Changes saved."
          : staff
            ? "Staff account created."
            : "Account created.",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="editor-form">
      <ErrorBanner error={error} />
      <div className="form-grid">
        <Field
          label="Full name"
          name="fullName"
          defaultValue={record?.customerProfile?.fullName}
          minLength={2}
          maxLength={50}
          required
          error={error?.fields?.fullName}
        />
        {!record && (
          <Field
            label="Username"
            name="username"
            required
            minLength={3}
            maxLength={40}
            autoComplete="off"
            error={error?.fields?.username}
          />
        )}
        <Field
          label="Email address"
          name="email"
          type="email"
          required
          defaultValue={record?.email}
          error={error?.fields?.email}
        />
        <Field
          label="Phone number"
          name="phone"
          defaultValue={record?.phone}
          required={staff || hotelRole}
          pattern="[0-9]{10,11}"
          hint="10–11 digits, no spaces."
          error={error?.fields?.phone}
        />
        {!record && (
          <Field
            label="Temporary password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            hint="Share privately; the user can change it in My profile."
          />
        )}
        <Field
          label="Role"
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={record?.role === "admin"}
        >
          <option value="" disabled>
            Select role
          </option>
          {roleOptions.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
          {record && !roleOptions.some((r) => r.key === record.role) && (
            <option value={record.role}>{record.role} (inactive)</option>
          )}
        </Field>
        <Field
          label="Status"
          name="status"
          defaultValue={record?.status || "active"}
          disabled={record?.role === "admin"}
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          {!staff && <option value="deleted">Removed (retain history)</option>}
        </Field>
        {hotelRole && (
          <>
            {!staff && (
              <Field
                label="Hotel"
                name="hotelId"
                defaultValue={record?.employeeProfile?.hotelId || ""}
                required
              >
                <option value="" disabled>
                  Select a hotel
                </option>
                {options.hotels.map((h) => (
                  <option value={h._id} key={h._id}>
                    {h.name}
                  </option>
                ))}
              </Field>
            )}
            <Field
              label="Position"
              name="position"
              defaultValue={record?.employeeProfile?.position}
              maxLength={100}
            />
            <Field
              label="Shift"
              name="shift"
              defaultValue={record?.employeeProfile?.shift}
              maxLength={100}
              placeholder="e.g. Morning"
            />
            <Field
              label="Hire date"
              name="hireDate"
              type="date"
              defaultValue={inputDate(record?.employeeProfile?.hireDate)}
            />
          </>
        )}
      </div>
      {record?.role === "admin" && (
        <p className="field-note">
          Administrator role and status are protected to keep system access
          available.
        </p>
      )}
      <div className="form-footer">
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <Submit busy={busy}>
          {record
            ? "Save changes"
            : staff
              ? "Create staff account"
              : "Create account"}
        </Submit>
      </div>
    </form>
  );
}
export default function Accounts({ staff = false }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState("");
  const path = staff ? "staff" : "users";
  const list = useResource(
    `/${path}?${new URLSearchParams({ q, status, page })}`,
  );
  const options = useResource("/options");
  function close() {
    setEditor(null);
  }
  return (
    <>
      <PageHeader
        eyebrow={staff ? "PEOPLE / YOUR HOTEL" : "ADMINISTRATION / PEOPLE"}
        title={staff ? "The people behind the stay." : "User accounts"}
        description={
          staff
            ? "Keep your team connected, informed and ready for the day."
            : "Manage the people who have access to your hotel system."
        }
        action={
          <button
            className="button primary"
            onClick={() => setEditor({})}
            disabled={!options.data}
          >
            <Plus size={17} />
            {staff ? "Add staff" : "Add account"}
          </button>
        }
      />
      <Success message={message} />
      <ErrorBanner error={options.error} retry={options.reload} />
      <section className="panel data-panel">
        <div className="panel-heading">
          <div>
            <h2>
              {staff ? "Team directory" : "Account directory"}{" "}
              <span className="count-pill">{list.meta?.total ?? "—"}</span>
            </h2>
            <p>
              {staff
                ? "Reception and housekeeping, all in one place."
                : "Access is defined by role. Account history is preserved."}
            </p>
          </div>
          <span className="panel-index">01 / DIRECTORY</span>
        </div>
        <SearchToolbar
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
        >
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            {!staff && <option value="deleted">Removed</option>}
          </select>
        </SearchToolbar>
        <ErrorBanner error={list.error} retry={list.reload} />
        {list.loading ? (
          <Loading />
        ) : !list.error && !list.data?.length ? (
          <Empty
            title={
              q || status
                ? "No matching people"
                : staff
                  ? "Your team starts here"
                  : "No accounts yet"
            }
            text={
              q || status
                ? "Try another search or clear the status filter."
                : "Add an account to get started."
            }
          />
        ) : (
          !list.error && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{staff ? "Team member" : "Account"}</th>
                    <th scope="col">Role / position</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Status</th>
                    <th scope="col">{staff ? "Joined" : "Created"}</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((u) => (
                    <tr key={u._id}>
                      <td>
                        <div className="person-cell">
                          <span className="avatar">
                            {(u.customerProfile?.fullName || u.username)
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                          <div>
                            <strong>
                              {u.customerProfile?.fullName || u.username}
                            </strong>
                            <small>@{u.username}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="capitalize">
                          {options.data?.roles.find((r) => r.key === u.role)
                            ?.name || u.role}
                        </span>
                        {u.employeeProfile?.position && (
                          <small>{u.employeeProfile.position}</small>
                        )}
                      </td>
                      <td>
                        {u.email}
                        <small>{u.phone || "No phone number"}</small>
                      </td>
                      <td>
                        <Badge value={u.status} />
                      </td>
                      <td className="nowrap">
                        {dateLabel(
                          staff ? u.employeeProfile?.hireDate : u.createdAt,
                        )}
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Edit ${u.customerProfile?.fullName || u.username}`}
                          onClick={() => setEditor(u)}
                        >
                          <Pencil size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        <Pagination meta={list.meta} setPage={setPage} />
      </section>
      <p className="below-panel">
        <ArrowUpRight size={15} />
        {staff
          ? "Role and status changes take effect on the next authenticated request."
          : "Suspended and removed accounts cannot sign in. Existing records remain available."}
      </p>
      <Modal
        open={!!editor}
        onClose={close}
        title={
          editor?._id
            ? staff
              ? "Edit staff member"
              : "Edit account"
            : staff
              ? "Add a team member"
              : "Add an account"
        }
      >
        {options.data && (
          <AccountForm
            key={editor?._id || "new"}
            record={editor?._id ? editor : null}
            staff={staff}
            options={options.data}
            onClose={close}
            onDone={(m) => {
              setMessage(m);
              close();
              list.reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}
