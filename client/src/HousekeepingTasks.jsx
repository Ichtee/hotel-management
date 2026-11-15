import { useState } from 'react';
import { useAuth } from './context/Auth.jsx';
import { api, dateLabel } from './api/client.js';
import { ReportIssue } from './RoomIssues.jsx';
import { Badge, DataTable, Notice, PageHead, useApi } from './ui.jsx';

// Tên dễ hiểu cho từng loại nhiệm vụ; chỉ dọn hằng ngày và theo yêu cầu được bỏ qua (BR server).
export const TASK_TYPES = { routine: 'Daily cleaning', ad_hoc: 'Guest request', turnover: 'Checkout cleaning', inspection: 'Room inspection' };
export const SKIPPABLE = ['routine', 'ad_hoc'];
export const taskName = (task) => `${TASK_TYPES[task.type] || task.type}${task.requestContent ? ` - ${task.requestContent}` : ''}`;

// Ngày theo giờ khách sạn để lọc theo ngày làm việc.
const hotelDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(d));
const STATUS_FILTERS = [['', 'All'], ['open', 'Not finished'], ['assigned', 'Assigned'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['skipped', 'Skipped']];

export default function HousekeepingTasks() {
  const { user } = useAuth();
  const canUpdate = user.permissions.includes('cleaning_tasks.status.update');
  const canReport = user.permissions.some((p) => ['room_issues.report', 'damages.report'].includes(p));
  const tasks = useApi('/housekeeping/tasks/mine');
  const rooms = useApi('/room-issues/options', canReport);
  const [reporting, setReporting] = useState(null);
  const [f, setF] = useState({ status: '', priority: '', date: '', room: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const room = f.room.trim().toLowerCase();
  const shown = (tasks.data || []).filter((t) =>
    (!f.status || (f.status === 'open' ? ['assigned', 'in_progress'].includes(t.status) : t.status === f.status))
    && (!f.priority || t.priority === f.priority)
    && (!f.date || hotelDay(t.scheduledDate || t.createdAt) === f.date)
    && (!room || String(t.roomId?.roomNumber || '').toLowerCase().includes(room)));
  const filtered = Object.values(f).some(Boolean);

  const changeStatus = async (task, status) => {
    // Bắt buộc nhập lý do khi bỏ qua nhiệm vụ dọn phòng.
    const reason = status === 'skipped' ? window.prompt('Reason for skipping (e.g. guest declined, Do not disturb):') : undefined;
    if (status === 'skipped' && !reason) return;
    try {
      await api(`/housekeeping/tasks/${task._id}/status`, { method: 'PATCH', body: reason ? { status, reason } : { status } });
      tasks.reload();
    } catch (error) {
      window.alert(error.message);
    }
  };

  return (
    <>
      <PageHead title="My cleaning tasks" sub="Start, then complete each task. Daily cleaning and guest requests can be skipped with a reason (e.g. Do not disturb). Checkout cleaning and room inspections cannot be skipped: the next guest needs the room." />
      <div className="filters-row" role="search">
        <label className="grow">Room number<input type="search" value={f.room} onChange={set('room')} placeholder="e.g. 205" maxLength="10" /></label>
        <label>Status<select value={f.status} onChange={set('status')}>{STATUS_FILTERS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select></label>
        <label>Priority<select value={f.priority} onChange={set('priority')}><option value="">All</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option></select></label>
        <label>Date<input type="date" value={f.date} onChange={set('date')} /></label>
        {filtered && <button type="button" className="btn" onClick={() => setF({ status: '', priority: '', date: '', room: '' })}>Clear</button>}
      </div>
      <Notice error={tasks.error} />
      {tasks.loading ? <p className="muted">Loading tasks...</p> : (
        <DataTable
          cols={['Room', 'Task', 'Priority', 'Scheduled', 'Status', '']}
          rows={shown.map((task) => [
            task.roomId ? <span className="nw"><b>Room {task.roomId.roomNumber}</b><small className="muted" style={{ display: 'block' }}>Floor {task.roomId.floor}</small></span> : 'Room unavailable',
            task.preferredTime ? `${taskName(task)} · at ${new Date(task.preferredTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}` : taskName(task),
            <Badge v={task.priority} />,
            dateLabel(task.scheduledDate || task.createdAt),
            <Badge v={task.status} />,
            <span className="row-actions">
              {canUpdate && task.status === 'assigned' && <button className="btn sm" onClick={() => changeStatus(task, 'in_progress')}>Start</button>}
              {canUpdate && task.status === 'in_progress' && <><button className="btn sm primary" onClick={() => changeStatus(task, 'completed')}>Complete</button></>}
              {canUpdate && ['assigned', 'in_progress'].includes(task.status) && (SKIPPABLE.includes(task.type)
                ? <button className="btn sm" onClick={() => changeStatus(task, 'skipped')}>Skip</button>
                : <button className="btn sm" disabled title={`${TASK_TYPES[task.type]} cannot be skipped`} aria-label={`Skip unavailable: ${TASK_TYPES[task.type]} cannot be skipped`}>Skip</button>)}
              {canReport && task.roomId && task.status !== 'skipped' && <button className="btn sm" onClick={() => setReporting(task.roomId._id)}>Report damage / issue</button>}
            </span>,
          ])}
        />
      )}
      {reporting && <ReportIssue rooms={rooms} roomId={reporting} onClose={() => setReporting(null)} />}
      {!tasks.loading && !tasks.error && !shown.length && <p className="muted center-msg">{filtered && (tasks.data || []).length ? 'No task matches these filters.' : 'No cleaning tasks are assigned to you.'}</p>}
    </>
  );
}
