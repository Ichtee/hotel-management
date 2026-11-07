import { useState } from 'react';
import { api, dateLabel } from './api/client.js';
import { ReportIssue } from './RoomIssues.jsx';
import { Badge, DataTable, Notice, PageHead, useApi } from './ui.jsx';

const taskName = (task) => `${task.type.replace('_', ' ')}${task.requestContent ? ` - ${task.requestContent}` : ''}`;

export default function HousekeepingTasks() {
  const tasks = useApi('/housekeeping/tasks/mine');
  const rooms = useApi('/room-issues/options');
  const [reporting, setReporting] = useState(null);

  const changeStatus = async (task, status) => {
    try {
      await api(`/housekeeping/tasks/${task._id}/status`, { method: 'PATCH', body: { status } });
      tasks.reload();
    } catch (error) {
      window.alert(error.message);
    }
  };

  return (
    <>
      <PageHead title="My cleaning tasks" sub="Start, complete or skip only tasks assigned to you. A completed turnover task releases the room for the next guest." />
      <Notice error={tasks.error} />
      {tasks.loading ? <p className="muted">Loading tasks...</p> : (
        <DataTable
          cols={['Room', 'Task', 'Priority', 'Scheduled', 'Status', '']}
          rows={(tasks.data || []).map((task) => [
            task.roomId ? `Room ${task.roomId.roomNumber} - Floor ${task.roomId.floor}` : 'Room unavailable',
            taskName(task),
            <Badge v={task.priority} />,
            dateLabel(task.scheduledDate || task.createdAt),
            <Badge v={task.status} />,
            <span className="row-actions">
              {task.status === 'assigned' && <button className="btn sm" onClick={() => changeStatus(task, 'in_progress')}>Start</button>}
              {task.status === 'in_progress' && <><button className="btn sm primary" onClick={() => changeStatus(task, 'completed')}>Complete</button><button className="btn sm" onClick={() => changeStatus(task, 'skipped')}>Skip</button></>}
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
