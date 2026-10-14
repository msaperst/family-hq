import { useEffect, useState } from 'react';

interface Schedule {
  id: string; name: string; mode: string; frequency: string;
  intervalCount: number; weekdays: number[]; anchorDate: string;
  endDate: string | null; rotation: string; paused: boolean; assignees: string[];
}
interface Child { id: string; name: string }
const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function localDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function ParentSettings() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'individual' | 'either' | 'each'>('individual');
  const [frequency, setFrequency] = useState<'once' | 'daily' | 'weekly' | 'interval_days' | 'interval_weeks'>('daily');
  const [intervalCount, setIntervalCount] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [anchorDate, setAnchorDate] = useState(localDate);
  const [endDate, setEndDate] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  async function load() {
    const [schedulesResponse, childrenResponse] = await Promise.all([fetch('/api/parent/schedules'), fetch('/api/children')]);
    if (!schedulesResponse.ok || !childrenResponse.ok) throw new Error('Unable to load parent settings');
    const schedulesData = await schedulesResponse.json() as { schedules: Schedule[] };
    const childrenData = await childrenResponse.json() as { children: Child[] };
    setSchedules(schedulesData.schedules);
    setChildren(childrenData.children);
  }
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load settings')); }, []);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/parent/schedules', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, mode, frequency, intervalCount, weekdays,
          anchorDate, endDate: endDate || null, rotation: 'none', assignees }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error || 'Could not create chore');
      setName('');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create chore'); }
    finally { setBusy(false); }
  }
  async function pause(schedule: Schedule) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/parent/schedules/' + encodeURIComponent(schedule.id), {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: !schedule.paused }),
      });
      if (!response.ok) throw new Error('Could not update schedule');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update schedule'); }
    finally { setBusy(false); }
  }
  return <main className="dashboard parent-settings">
    <header className="dashboard-header">
      <div><h1>Family HQ · Parent settings</h1><p>Manage recurring chores</p></div>
      <a href="/">Back to dashboard</a>
    </header>
    {error && <p role="alert" className="error">{error}</p>}
    <section className="settings-panel">
      <h2>Scheduled chores</h2>
      {schedules.length === 0 && <p>No schedules yet.</p>}
      <ul className="schedule-list">{schedules.map(schedule => <li key={schedule.id}>
        <div><strong>{schedule.name}</strong>
          <p>{schedule.frequency.replaceAll('_', ' ')} · {schedule.assignees.map(id => children.find(child => child.id === id)?.name ?? id).join(', ')} · {schedule.paused ? 'Paused' : 'Active'}</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void pause(schedule)}>{schedule.paused ? 'Resume' : 'Pause'}</button>
      </li>)}</ul>
    </section>
    <section className="settings-panel">
      <h2>Add a chore</h2>
      <form onSubmit={event => void create(event)} className="settings-form">
        <label>Chore name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Who completes it?
          <select value={mode} onChange={event => { setMode(event.target.value as typeof mode); setAssignees([]); }}>
            <option value="individual">One child</option><option value="either">Either child</option><option value="each">Each child</option>
          </select>
        </label>
        <fieldset><legend>Assign to</legend>
          {children.map(child => <label key={child.id} className="settings-checkbox">
            <input type={mode === 'individual' ? 'radio' : 'checkbox'} name="assignee"
              checked={assignees.includes(child.id)}
              onChange={() => setAssignees(previous => mode === 'individual' ? [child.id] :
                previous.includes(child.id) ? previous.filter(id => id !== child.id) : [...previous, child.id])} />
            {child.name}
          </label>)}
        </fieldset>
        <label>Repeat
          <select value={frequency} onChange={event => setFrequency(event.target.value as typeof frequency)}>
            <option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
            <option value="interval_days">Every N days</option><option value="interval_weeks">Every N weeks</option>
          </select>
        </label>
        {(frequency === 'interval_days' || frequency === 'interval_weeks') && <label>Repeat interval
          <input type="number" min={1} max={365} value={intervalCount} onChange={event => setIntervalCount(Number(event.target.value))} />
        </label>}
        {(frequency === 'daily' || frequency === 'weekly' || frequency === 'interval_days' || frequency === 'interval_weeks') &&
          <fieldset><legend>Days of week {frequency === 'weekly' ? '(optional: all week for flexible due date)' : '(optional)'}</legend>
            {weekdayNames.map((day, index) => <label key={day} className="settings-checkbox">
              <input type="checkbox" checked={weekdays.includes(index)}
                onChange={() => setWeekdays(previous => previous.includes(index) ? previous.filter(d => d !== index) : [...previous, index].sort())} />{day}
            </label>)}
          </fieldset>}
        <label>Start date<input type="date" required value={anchorDate} onChange={event => setAnchorDate(event.target.value)} /></label>
        <label>End date (optional)<input type="date" min={anchorDate} value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
        <button type="submit" disabled={busy || !name.trim() || !assignees.length}>Add chore</button>
      </form>
    </section>
  </main>;
}
