export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface User {
  id: string;
  username: string;
  email: string;
  role?: "PRODUCT_MANAGER" | "SCRUM_MASTER" | "DEVELOPER";
}

export interface Column {
  _id: string;
  title: string;
  order: number;
}

export interface Task {
  _id: string;
  title: string;
  description?: string;
  boardId: string;
  columnId: string;
  order: number;
  priority: Priority;
  dueDate?: string;
  storyPoints?: number;
  assignedTo?: { _id: string; username: string } | null;
}

export interface Board {
  _id: string;
  title: string;
  description?: string;
}

export interface BoardState {
  columns: Column[];
  tasks: Task[];
}

export interface SprintMetrics {
  totalTasks: number;
  completedTasks: number;
  completion: number;
  velocity: number;
  completedStoryPoints: number;
  burndown: Array<{
    date: string;
    idealRemaining: number;
    remainingStoryPoints?: number;
  }>;
}

export interface Sprint {
  _id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: "PLANNING" | "ACTIVE" | "COMPLETED";
}
