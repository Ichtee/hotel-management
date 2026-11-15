import { useState } from 'react';
import { api, dateLabel } from './api/client.js';
import { ReportIssue } from './RoomIssues.jsx';
import { Badge, DataTable, Notice, PageHead, useApi } from './ui.jsx';

// Tên dễ hiểu cho từng loại nhiệm vụ; chỉ dọn hằng ngày và theo yêu cầu được bỏ qua (BR server).
export const TASK_TYPES = { routine: 'Daily cleaning', ad_hoc: 'Guest request', turnover: 'Checkout cleaning', inspection: 'Room inspection' };
export const SKIPPABLE = ['routine', 'ad_hoc'];
export const taskName = (task) => `${TASK_TYPES[task.type] || task.type}${task.requestContent ? ` - ${task.requestContent}` : ''}`;

export default function HousekeepingTasks() {
  const tasks = useApi('/housekeeping/tasks/mine');
  const rooms = useApi('/room-issues/options');
  const [reporting, setReporting] = useState(null);

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
      <Notice error={tasks.error} />
      {tasks.loading ? <p className="muted">Loading tasks...</p> : (
        <DataTable
          cols={['Room', 'Task', 'Priority', 'Scheduled', 'Status', '']}
          rows={(tasks.data || []).map((task) => [
            task.roomId ? <span className="nw"><b>Room {task.roomId.roomNumber}</b><small className="muted" style={{ display: 'block' }}>Floor {task.roomId.floor}</small></span> : 'Room unavailable',
            task.preferredTime ? `${taskName(task)} · at ${new Date(task.preferredTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}` : taskName(task),
            <Badge v={task.priority} />,
            dateLabel(task.scheduledDate || task.createdAt),
            <Badge v={task.status} />,
            <span className="row-actions">
              {task.status === 'assigned' && <button className="btn sm" onClick={() => changeStatus(task, 'in_progress')}>Start</button>}
              {task.status === 'in_progress' && <><button className="btn sm primary" onClick={() => changeStatus(task, 'completed')}>Complete</button></>}
              {['assigned', 'in_progress'].includes(task.status) && (SKIPPABLE.includes(task.type)
                ? <button className="btn sm" onClick={() => changeStatus(task, 'skipped')}>Skip</button>
                : <button className="btn sm" disabled title={`${TASK_TYPES[task.type]} cannot be skipped`} aria-label={`Skip unavailable: ${TASK_TYPES[task.type]} cannot be skipped`}>Skip</button>)}
              {task.roomId && task.status !== 'skipped' && <button className="btn sm" onClick={() => setReporting(task.roomId._id)}>Report damage / issue</button>}
            </span>,
          ])}
        />
      )}
      {reporting && <ReportIssue rooms={rooms} roomId={reporting} onClose={() => setReporting(null)} />}
      {!tasks.loading && !tasks.error && !(tasks.data || []).length && <p className="muted center-msg">No cleaning tasks are assigned to you.</p>}
    </>
  );
}
