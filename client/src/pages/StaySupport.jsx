import { useState } from "react";
import { api, money, dateLabel } from "../api/client.js";
import { Badge, DataTable, Field, Notice, PageHead, useApi } from "../ui.jsx";
import { useAuth } from "../context/Auth.jsx";
import { DamageForm, useStayAction } from "./FrontDesk.jsx";

export function StayCatalog() {
  const [kind, setKind] = useState("services"),
    [editing, setEditing] = useState(null);
  const s = useApi(`/catalog/${kind}`),
    a = useStayAction(() => {
      s.reload();
      setEditing(null);
    });
  return (
    <div className="stay-workspace">
      <PageHead
        title="Danh mục dịch vụ & bồi thường"
        sub="Giá đã ghi nhận cho booking được giữ nguyên khi sửa danh mục."
      />
      <select
        aria-label="Danh mục"
        value={kind}
        onChange={(e) => {
          setKind(e.target.value);
          setEditing(null);
        }}
      >
        <option value="services">Dịch vụ</option>
        <option value="compensation-items">Bồi thường</option>
      </select>
      <Notice error={s.error} />
      <section className="panel">
        <button className="btn" onClick={() => setEditing({})}>
          Thêm hạng mục
        </button>
        {s.loading ? (
          <p>Đang tải…</p>
        ) : (
          <DataTable
            cols={["Tên", "Đơn giá", "Trạng thái", ""]}
            rows={(s.data || []).map((r) => [
              r.name,
              money(r.unitPrice),
              r.isActive ? "Đang dùng" : "Ngừng dùng",
              <button className="btn" onClick={() => setEditing(r)}>
                Sửa
              </button>,
            ])}
          />
        )}
        {!s.loading && !s.data?.length && <p>Danh mục trống.</p>}
        {editing && (
          <form
            key={`${kind}-${editing._id || "new"}`}
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              a.run(
                `/catalog/${kind}${editing._id ? `/${editing._id}` : ""}`,
                {
                  name: f.name,
                  unitPrice: Number(f.unitPrice),
                  isActive: f.isActive === "on",
                },
                editing._id ? "PATCH" : "POST",
              );
            }}
          >
            <Field label="Tên hạng mục">
              <input
                name="name"
                required
                maxLength="100"
                defaultValue={editing.name}
              />
            </Field>
            <Field label="Đơn giá VND">
              <input
                name="unitPrice"
                type="number"
                min="0"
                max="1000000000000"
                required
                defaultValue={editing.unitPrice}
              />
            </Field>
            <label className="check">
              <input
                name="isActive"
                type="checkbox"
                defaultChecked={editing.isActive !== false}
              />
              Đang dùng
            </label>
            <button className="btn primary" disabled={a.busy}>
              Lưu danh mục
            </button>
          </form>
        )}
        {a.notice}
      </section>
    </div>
  );
}

function TaskActions({ task, reload }) {
  const { user } = useAuth(),
    a = useStayAction(reload);
  const can = (permission) => user.permissions.includes(permission);
  const [damage, setDamage] = useState(false),
    [issue, setIssue] = useState(false);
  return (
    <article className="panel">
      <h3>
        Phòng {task.roomId?.roomNumber} · {task.type}
      </h3>
      <p>
        <Badge v={task.status} /> · {task.priority} ·{" "}
        {dateLabel(task.scheduledDate)}
      </p>
      <p>{task.requestContent || task.inspectionResult || task.skipReason}</p>
      {can("cleaning_tasks.status.update") && task.status === "assigned" && (
        <button
          className="btn"
          disabled={a.busy}
          onClick={() =>
            a.run(
              `/housekeeping/tasks/${task._id}/status`,
              { status: "in_progress" },
              "PATCH",
            )
          }
        >
          Bắt đầu
        </button>
      )}
      {can("cleaning_tasks.status.update") && task.status === "in_progress" && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            a.run(
              `/housekeeping/tasks/${task._id}/status`,
              {
                status: "completed",
                ...(task.type === "inspection"
                  ? { result: new FormData(e.currentTarget).get("result") }
                  : {}),
              },
              "PATCH",
            );
          }}
        >
          {task.type === "inspection" && (
            <Field label="Kết quả kiểm tra">
              <textarea name="result" required minLength="2" maxLength="1000" />
            </Field>
          )}
          <button className="btn primary" disabled={a.busy}>
            Hoàn thành
          </button>
        </form>
      )}
      <div className="stay-actions">
        {can("damages.report") && task.bookingId && (
          <button className="btn" onClick={() => setDamage(!damage)}>
            Báo thiệt hại
          </button>
        )}
        {can("room_issues.report") && (
          <button className="btn" onClick={() => setIssue(!issue)}>
            Báo sự cố phòng
          </button>
        )}
      </div>
      {damage && (
        <DamageForm
          bookingId={task.bookingId}
          taskId={task._id}
          onDone={reload}
        />
      )}
      {issue && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            a.run("/housekeeping/issues", {
              roomId: task.roomId._id,
              taskId: task._id,
              description: new FormData(e.currentTarget).get("description"),
            });
          }}
        >
          <Field label="Mô tả sự cố">
            <textarea
              name="description"
              required
              minLength="2"
              maxLength="1000"
            />
          </Field>
          <button className="btn" disabled={a.busy}>
            Gửi sự cố
          </button>
        </form>
      )}
      {a.notice}
    </article>
  );
}

export function StayTasks() {
  const s = useApi("/housekeeping/tasks");
  return (
    <div className="stay-workspace">
      <PageHead
        title="Công việc của tôi"
        sub="Kiểm tra trả phòng, vệ sinh và báo thiệt hại"
        extra={
          <button className="btn" onClick={s.reload}>
            Tải lại
          </button>
        }
      />
      <Notice error={s.error} />
      {s.loading ? (
        <p>Đang tải…</p>
      ) : !s.data?.length ? (
        <p>Chưa có công việc được giao.</p>
      ) : (
        s.data.map((t) => (
          <TaskActions key={t._id} task={t} reload={s.reload} />
        ))
      )}
    </div>
  );
}

export function StayNotifications() {
  const s = useApi("/notifications"),
    a = useStayAction(s.reload);
  return (
    <div className="stay-workspace">
      <PageHead
        title="Thông báo"
        extra={
          <button className="btn" onClick={s.reload}>
            Tải lại
          </button>
        }
      />
      <Notice error={s.error} />
      {s.loading ? (
        <p>Đang tải…</p>
      ) : !s.data?.length ? (
        <p>Chưa có thông báo.</p>
      ) : (
        s.data.map((n) => (
          <article className="panel" key={n._id}>
            <h3>{n.title || n.type}</h3>
            <p>{n.message}</p>
            <p>{dateLabel(n.createdAt)}</p>
            {!n.isRead && (
              <button
                className="btn"
                disabled={a.busy}
                onClick={() =>
                  a.run(`/notifications/${n._id}/read`, {}, "PATCH")
                }
              >
                Đánh dấu đã đọc
              </button>
            )}
          </article>
        ))
      )}
      {a.notice}
    </div>
  );
}

export function StayHotelInfo() {
  const s = useApi("/hotel-info"),
    a = useStayAction(s.reload);
  return (
    <div className="stay-workspace">
      <PageHead
        title="Thông tin khách sạn"
        sub="Thông tin dùng trên hóa đơn mới. Hóa đơn đã phát hành giữ nguyên."
      />
      <Notice error={s.error} />
      {s.loading ? (
        <p>Đang tải…</p>
      ) : (
        !s.error && (
          <form
            className="panel form"
            key={s.data?.updatedAt || "new"}
            onSubmit={(e) => {
              e.preventDefault();
              a.run(
                "/hotel-info",
                Object.fromEntries(new FormData(e.currentTarget)),
                "PUT",
              );
            }}
          >
            <Field label="Tên khách sạn">
              <input
                name="name"
                required
                minLength="2"
                maxLength="120"
                defaultValue={s.data?.name}
              />
            </Field>
            <Field label="Địa chỉ">
              <input
                name="address"
                required
                maxLength="300"
                defaultValue={s.data?.address}
              />
            </Field>
            <Field label="Điện thoại">
              <input
                name="phone"
                pattern="[0-9]{10,11}"
                defaultValue={s.data?.phone}
              />
            </Field>
            <Field label="Email">
              <input name="email" type="email" defaultValue={s.data?.email} />
            </Field>
            <Field label="Giới thiệu">
              <textarea
                name="description"
                maxLength="2000"
                defaultValue={s.data?.description}
              />
            </Field>
            <button className="btn primary" disabled={a.busy}>
              Lưu thông tin
            </button>
            {a.notice}
          </form>
        )
      )}
      <a href="#/admin/policy">Chính sách nhận / trả phòng →</a>
    </div>
  );
}
