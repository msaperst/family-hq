export type ChoreMode = 'individual' | 'each' | 'either';
export interface DashboardChore {
  id: string;
  name: string;
  startsOn: string;
  dueOn: string;
  mode: ChoreMode;
  childId: string | null;
  completed: boolean;
}
export interface DashboardColumn {
  id: string;
  name: string;
  chores: DashboardChore[];
}
export interface DashboardResponse {
  today: string;
  through: string;
  columns: DashboardColumn[];
}
export interface ChildResponse { id: string; name: string }
