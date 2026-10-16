import { useEffect, useRef, useState } from 'react';

interface Schedule {
  id: string; name: string; mode: string; frequency: string;
  intervalCount: number; weekdays: number[]; anchorDate: string;
  endDate: string | null; rotation: string; paused: boolean; assignees: string[];
}
interface Child { id: string; name: string; active?: boolean | number }
interface Occurrence { key: string; startsOn: string; dueOn: string; assignees: string[]; skipped: boolean }
interface Exception { originalDate: string; action: string; newDate: string | null; childId: string | null }
const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function localDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function scheduleFrequencyLabel(schedule: Schedule): string {
  if (schedule.frequency !== 'weekly') return schedule.frequency.replaceAll('_', ' ');
  if (schedule.weekdays.length === 0) return 'Weekly · due Sunday';
  return 'Weekly · ' + schedule.weekdays.map(day => weekdayNames[day]).join(', ');
}
function toggleAssignee(previous: string[], childId: string, individual: boolean): string[] {
  if (individual) return [childId];
  if (previous.includes(childId)) return previous.filter(id => id !== childId);
  return [...previous, childId];
}
export function ParentSettings() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [managedChildren, setManagedChildren] = useState<Child[]>([]);
  const [newChildName, setNewChildName] = useState('');
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [editingChildName, setEditingChildName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mutationLock = useRef(false);
  async function runMutation(operation: () => Promise<void>): Promise<void> {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError('');
    try { await operation(); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionAction, setExceptionAction] = useState<'skip' | 'move' | 'reassign'>('skip');
  const [exceptionNewDate, setExceptionNewDate] = useState('');
  const [exceptionChild, setExceptionChild] = useState('');
  const [rotation, setRotation] = useState<'none' | 'daily' | 'weekly'>('none');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'individual' | 'either' | 'each'>('individual');
  const [frequency, setFrequency] = useState<'once' | 'daily' | 'weekly' | 'interval_days' | 'interval_weeks'>('daily');
  const [intervalCount, setIntervalCount] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [weeklyFlexible, setWeeklyFlexible] = useState(true);
  const [anchorDate, setAnchorDate] = useState(localDate);
  const [endDate, setEndDate] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  async function load() {
    const [schedulesResponse, childrenResponse, managedResponse] = await Promise.all([fetch('/api/parent/schedules'), fetch('/api/children'), fetch('/api/parent/children')]);
    if (!schedulesResponse.ok || !childrenResponse.ok || !managedResponse.ok) throw new Error('Unable to load parent settings');
    const schedulesData = await schedulesResponse.json() as { schedules: Schedule[] };
    const childrenData = await childrenResponse.json() as { children: Child[] };
    setSchedules(schedulesData.schedules);
    setChildren(childrenData.children);
    setManagedChildren((await managedResponse.json() as { children: Child[] }).children);
  }
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load settings')); }, []);
  async function saveChild(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runMutation(async () => {
      try {
        const response = await fetch(editingChildId ? '/api/parent/children/' + encodeURIComponent(editingChildId) : '/api/parent/children', {
          method: editingChildId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: editingChildId ? editingChildName : newChildName }),
        });
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? 'Unable to save child');
        setNewChildName(''); setEditingChildId(null); setEditingChildName('');
        await load();
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save child'); }
    });
  }
  async function changeChildStatus(child: Child) {
    await runMutation(async () => {
      try {
        const response = await fetch('/api/parent/children/' + encodeURIComponent(child.id), {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ active: !Boolean(child.active) }),
        });
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? 'Unable to update child');
        await load();
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update child'); }
    });
  }
  async function loadOccurrences(id: string) {
    const [preview, overrides] = await Promise.all([
      fetch('/api/parent/schedules/' + encodeURIComponent(id) + '/preview'),
      fetch('/api/parent/schedules/' + encodeURIComponent(id) + '/exceptions'),
    ]);
    if (!preview.ok || !overrides.ok) throw new Error('Could not load schedule preview');
    setOccurrences((await preview.json() as { occurrences: Occurrence[] }).occurrences);
    setExceptions((await overrides.json() as { exceptions: Exception[] }).exceptions);
  }
  function edit(schedule: Schedule) {
    setEditingId(schedule.id); setName(schedule.name);
    setExceptionDate(''); setExceptionAction('skip'); setExceptionNewDate(''); setExceptionChild('');
    void loadOccurrences(schedule.id).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load preview'));
    setMode(schedule.mode as typeof mode); setFrequency(schedule.frequency as typeof frequency);
    setIntervalCount(schedule.intervalCount); setWeekdays(schedule.weekdays);
    setWeeklyFlexible(schedule.frequency === 'weekly' && schedule.weekdays.length === 0);
    setAnchorDate(schedule.anchorDate); setEndDate(schedule.endDate ?? '');
    setRotation(schedule.rotation as typeof rotation); setAssignees(schedule.assignees);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }
  function resetForm() {
    setEditingId(null); setName(''); setMode('individual'); setFrequency('daily');
    setIntervalCount(1); setWeekdays([]); setWeeklyFlexible(true); setAnchorDate(localDate());
    setEndDate(''); setRotation('none'); setAssignees([]);
    setOccurrences([]); setExceptions([]); setExceptionDate('');
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runMutation(async () => {
    try {
      const response = await fetch(editingId ? '/api/parent/schedules/' + encodeURIComponent(editingId) : '/api/parent/schedules', {
        method: editingId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, mode, frequency, intervalCount, weekdays: frequency === 'weekly' && weeklyFlexible ? [] : weekdays,
          anchorDate, endDate: endDate || null, rotation, assignees }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error || 'Could not create chore');
      resetForm();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create chore'); }
    });
  }
  async function saveException(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    await runMutation(async () => {
    try {
      const response = await fetch('/api/parent/schedules/' + encodeURIComponent(editingId!) +
        '/exceptions/' + encodeURIComponent(exceptionDate), {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: exceptionAction,
          ...(exceptionAction === 'move' ? { newDate: exceptionNewDate } : {}),
          ...(exceptionAction === 'reassign' ? { childId: exceptionChild } : {}) }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? 'Could not save exception');
      await loadOccurrences(editingId!);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save exception'); }
    });
  }
  async function removeException(date: string) {
    if (!editingId) return;
    await runMutation(async () => {
    try {
      const response = await fetch('/api/parent/schedules/' + encodeURIComponent(editingId!) +
        '/exceptions/' + encodeURIComponent(date), { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not remove exception');
      await loadOccurrences(editingId!);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove exception'); }
    });
  }
  async function pause(schedule: Schedule) {
    await runMutation(async () => {
    try {
      const response = await fetch('/api/parent/schedules/' + encodeURIComponent(schedule.id), {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: !schedule.paused }),
      });
      if (!response.ok) throw new Error('Could not update schedule');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update schedule'); }
    });
  }
  return <main className="dashboard parent-settings">
    <header className="dashboard-header">
      <div><h1>Family HQ · Parent settings</h1><p>Manage recurring chores</p></div>
      <a href="/">Back to dashboard</a>
    </header>
    {error && <p role="alert" className="error">{error}</p>}
    <section className="settings-panel">
      <h2>Children</h2>
      <p>Add children before assigning chores. Names can be changed without losing existing history.</p>
      {managedChildren.length === 0 && <p>No children yet. Add a child to get started.</p>}
      <ul className="schedule-list">{managedChildren.map(child => <li key={child.id}>
        <span><strong>{child.name}</strong>{!Boolean(child.active) && ' (Inactive)'}</span>
        <div className="schedule-actions">
          <button type="button" disabled={busy} onClick={() => { setEditingChildId(child.id); setEditingChildName(child.name); }}>Rename</button>
          <button type="button" disabled={busy} onClick={() => void changeChildStatus(child)}>{Boolean(child.active) ? 'Deactivate' : 'Reactivate'}</button>
        </div>
      </li>)}</ul>
      <form className="settings-form" onSubmit={event => void saveChild(event)}>
        <label>{editingChildId ? 'Rename child' : 'Child name'}
          <input required maxLength={80} value={editingChildId ? editingChildName : newChildName}
            onChange={event => editingChildId ? setEditingChildName(event.target.value) : setNewChildName(event.target.value)} />
        </label>
        <div className="schedule-actions">
          <button type="submit" disabled={busy || !(editingChildId ? editingChildName : newChildName).trim()}>{editingChildId ? 'Save child name' : 'Add child'}</button>
          {editingChildId && <button type="button" disabled={busy} onClick={() => { setEditingChildId(null); setEditingChildName(''); }}>Cancel</button>}
        </div>
      </form>
    </section>
    <section className="settings-panel">
      <h2>Scheduled chores</h2>
      {schedules.length === 0 && <p>No schedules yet.</p>}
      <ul className="schedule-list">{schedules.map(schedule => <li key={schedule.id}>
        <div><strong>{schedule.name}</strong>
          <p>{scheduleFrequencyLabel(schedule)} · {schedule.assignees.map(id => children.find(child => child.id === id)?.name ?? id).join(', ')} · {schedule.paused ? 'Paused' : 'Active'}</p>
        </div>
        <div className="schedule-actions"><button type="button" disabled={busy} onClick={() => edit(schedule)}>Edit</button>
        <button type="button" disabled={busy} onClick={() => void pause(schedule)}>{schedule.paused ? 'Resume' : 'Pause'}</button></div>
      </li>)}</ul>
    </section>
    <section className="settings-panel">
      <h2>{editingId ? 'Edit chore' : 'Add a chore'}</h2>
      <form onSubmit={event => void create(event)} className="settings-form">
        <label>Chore name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Who completes it?{' '}
          <select value={mode} onChange={event => { setMode(event.target.value as typeof mode); setRotation('none'); setAssignees([]); }}>
            <option value="individual">One child</option><option value="either">Either child</option><option value="each">Each child</option>
          </select>
        </label>
        <fieldset><legend>Assign to</legend>
          {children.length === 0 && <p>Add a child above before assigning chores.</p>}
          {children.map(child => <label key={child.id} className="settings-checkbox">
            <input type={mode === 'individual' && rotation === 'none' ? 'radio' : 'checkbox'} name="assignee"
              checked={assignees.includes(child.id)}
              onChange={() => setAssignees(previous => toggleAssignee(previous, child.id, mode === 'individual' && rotation === 'none'))} />
            {child.name}
          </label>)}
        </fieldset>
        {mode === 'individual' && <label>Rotate assignment{' '}
          <select value={rotation} onChange={event => { const next = event.target.value as typeof rotation; setRotation(next); if (next === 'none') setAssignees(previous => previous.slice(0, 1)); }}>
            <option value="none">No rotation</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
          </select>
        </label>}
        <label>Repeat{' '}
          <select value={frequency} onChange={event => { const next = event.target.value as typeof frequency; setFrequency(next); if (next === 'weekly') setWeeklyFlexible(weekdays.length === 0); }}>
            <option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
            <option value="interval_days">Every N days</option><option value="interval_weeks">Every N weeks</option>
          </select>
        </label>
        {(frequency === 'interval_days' || frequency === 'interval_weeks') && <label>Repeat interval{' '}
          <input type="number" min={1} max={365} value={intervalCount} onChange={event => setIntervalCount(Number(event.target.value))} />
        </label>}
        {frequency === 'weekly' && <fieldset><legend>Weekly deadline</legend>
          <label className="settings-checkbox"><input type="radio" name="weeklyDeadline" checked={weeklyFlexible}
            onChange={() => { setWeeklyFlexible(true); setWeekdays([]); }} />Anytime during the week, due Sunday</label>
          <label className="settings-checkbox"><input type="radio" name="weeklyDeadline" checked={!weeklyFlexible}
            onChange={() => { setWeeklyFlexible(false); setWeekdays([6]); }} />On selected day(s)</label>
        </fieldset>}
        {(frequency === 'daily' || (frequency === 'weekly' && !weeklyFlexible) || frequency === 'interval_days' || frequency === 'interval_weeks') &&
          <fieldset><legend>Days of week {frequency === 'weekly' ? '(choose at least one)' : '(optional)'}</legend>
            {weekdayNames.map((day, index) => <label key={day} className="settings-checkbox">
              <input type="checkbox" checked={weekdays.includes(index)}
                onChange={() => setWeekdays(previous => previous.includes(index) ? previous.filter(d => d !== index) : [...previous, index].sort((a, b) => a - b))} />{day}
            </label>)}
          </fieldset>}
        <label>Start date<input type="date" required value={anchorDate} onChange={event => setAnchorDate(event.target.value)} /></label>
        <label>End date (optional)<input type="date" min={anchorDate} value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
        <div className="schedule-actions"><button type="submit" disabled={busy || !name.trim() || !assignees.length || (frequency === 'weekly' && !weeklyFlexible && weekdays.length === 0)}>{editingId ? 'Save changes' : 'Add chore'}</button>
        {editingId && <button type="button" disabled={busy} onClick={resetForm}>Cancel editing</button>}</div>
      </form>
    </section>
    {editingId && <section className="settings-panel">
      <h2>Upcoming occurrences</h2>
      <p>Preview of the saved schedule. Save edits above to update this preview.</p>
      {occurrences.length === 0 && <p>No upcoming occurrences in the next four weeks.</p>}
      <ul className="schedule-list">{occurrences.slice(0, 15).map(occurrence => <li key={occurrence.key}>
        <span>{occurrence.startsOn === occurrence.dueOn ? occurrence.dueOn : occurrence.startsOn + ' – ' + occurrence.dueOn}
          {' · '}{occurrence.skipped ? 'Skipped' : occurrence.assignees.map(id => children.find(child => child.id === id)?.name ?? id).join(', ')}</span>
        <button type="button" disabled={(occurrence.key.split(":").at(-1)!) < localDate()} onClick={() => setExceptionDate(occurrence.key.split(':').at(-1)!)}>Exception</button>
      </li>)}</ul>
      <h3>One-day exception</h3>
      <form className="settings-form" onSubmit={event => void saveException(event)}>
        <label>Original scheduled date<input type="date" required min={localDate()} value={exceptionDate}
          onChange={event => setExceptionDate(event.target.value)} /></label>
        <label>Action<select value={exceptionAction} onChange={event => setExceptionAction(event.target.value as typeof exceptionAction)}>
          <option value="skip">Skip this occurrence</option><option value="move">Move to another date</option>
          <option value="reassign">Assign to another child</option>
        </select></label>
        {exceptionAction === 'move' && <label>New date<input type="date" required min={localDate()} value={exceptionNewDate}
          onChange={event => setExceptionNewDate(event.target.value)} /></label>}
        {exceptionAction === 'reassign' && <label>Assign to<select required value={exceptionChild}
          onChange={event => setExceptionChild(event.target.value)}>
          <option value="">Choose a child</option>{children.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}
        </select></label>}
        <button type="submit" disabled={busy || !exceptionDate}>Save exception</button>
      </form>
      {exceptions.length > 0 && <><h3>Existing exceptions</h3><ul className="schedule-list">{exceptions.map(item =>
        <li key={item.originalDate}><span>{item.originalDate}: {item.action}
          {item.newDate ? ' → ' + item.newDate : ''}{item.childId ? ' → ' + (children.find(child => child.id === item.childId)?.name ?? item.childId) : ''}</span>
          <button type="button" disabled={busy || item.originalDate < localDate()}
            onClick={() => void removeException(item.originalDate)}>Remove</button></li>)}</ul></>}
    </section>}
  </main>;
}
