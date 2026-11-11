import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUp,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  Flame,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Target,
  Users,
  X,
} from "lucide-react";
import { DragDropContext, Draggable, Droppable, DropResult } from "@hello-pangea/dnd";
import { io, Socket } from "socket.io-client";
import { api, apiBaseUrl } from "./api";
import { Board, BoardState, Column, Sprint, SprintMetrics, Task, User } from "./types";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";

type AuthMode = "login" | "register";
type PriorityFilter = "ALL" | Task["priority"];

const priorityOrder: Task["priority"][] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const initials = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const avatarColors = ["#d9e7ff", "#fce2cc", "#dcf2e7", "#eee1fa"];

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineCount, setOnlineCount] = useState(1);
  const [board, setBoard] = useState<Board | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardState, setBoardState] = useState<BoardState>({ columns: [], tasks: [] });
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [metrics, setMetrics] = useState<SprintMetrics | null>(null);
  const [filter, setFilter] = useState<PriorityFilter>("ALL");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnTitle, setColumnTitle] = useState("");
  const [error, setError] = useState("");

  const loadBoard = useCallback(async (selected: Board) => {
    const [detail, metricResponse] = await Promise.all([
      api.get(`/api/boards/${selected._id}`),
      api.get(`/api/boards/${selected._id}/sprints/metrics`),
    ]);
    setBoard(detail.data.board);
    setBoardState({ columns: detail.data.columns, tasks: detail.data.tasks });
    setSprint(metricResponse.data.sprint);
    setMetrics(metricResponse.data.metrics);
  }, []);

  const refreshBoard = useCallback(async (selectedBoardId?: string) => {
    const boardResponse = await api.get("/api/boards");
    const availableBoards = boardResponse.data.boards as Board[];
    setBoards(availableBoards);
    const selected = availableBoards.find((item) => item._id === selectedBoardId) ?? availableBoards[0];
    if (!selected) {
      setError("No workspace is available for this account.");
      return;
    }
    await loadBoard(selected);
  }, [loadBoard]);

  useEffect(() => {
    api.get("/api/auth/me")
      .then(async ({ data }) => {
        setUser(data.user);
        await refreshBoard();
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [refreshBoard]);

  useEffect(() => {
    if (!user || !board) return;
    const client = io(apiBaseUrl, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
    client.on("connect", () => {
      setConnected(true);
      client.emit("board:join", board._id);
    });
    client.on("disconnect", () => setConnected(false));
    client.on("board:state-updated", (nextState: BoardState) => {
      setBoardState(nextState);
      api.get(`/api/boards/${board._id}/sprints/metrics`)
        .then(({ data }) => {
          setSprint(data.sprint);
          setMetrics(data.metrics);
        })
        .catch((requestError: unknown) => {
          setNotice(getErrorMessage(requestError, "Could not refresh sprint metrics."));
        });
    });
    client.on("board:presence", (count: number) => setOnlineCount(count));
    client.on("board:error", (payload: { message?: string }) => {
      setNotice(payload.message || "That update could not be saved.");
      void refreshBoard(board._id).catch((requestError: unknown) => {
        setNotice(getErrorMessage(requestError, "Could not reload the board."));
      });
    });
    setSocket(client);
    return () => {
      client.disconnect();
      setSocket(null);
    };
  }, [user, board?._id, refreshBoard]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const visibleTasks = useMemo(() => boardState.tasks.filter((task) => {
    const matchesSearch = `${task.title} ${task.description ?? ""}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (filter === "ALL" || task.priority === filter);
  }), [boardState.tasks, filter, search]);

  async function handleAuth(event: FormEvent<HTMLFormElement>, mode: AuthMode) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const { data } = await api.post(path, {
        email: form.get("email"),
        password: form.get("password"),
        ...(mode === "register" ? { username: form.get("username") } : {}),
      });
      setUser(data.user);
      await refreshBoard();
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, "We couldn't sign you in. Please try again."));
    }
  }

  async function logout() {
    await api.post("/api/auth/logout");
    socket?.disconnect();
    setUser(null);
    setBoard(null);
    setBoardState({ columns: [], tasks: [] });
  }

  async function selectBoard(boardId: string) {
    const selected = boards.find((item) => item._id === boardId);
    if (!selected || selected._id === board?._id) return;
    try {
      await loadBoard(selected);
    } catch (requestError: unknown) {
      setNotice(getErrorMessage(requestError, "Could not open that project."));
    }
  }

  function onDragEnd(result: DropResult) {
    if (!result.destination || !board || !socket) return;
    const { source, destination, draggableId } = result;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;
    const moved = boardState.tasks.find((task) => task._id === draggableId);
    if (!moved) return;
    const oldState = boardState;
    const taskColumns = new Map<string, Task[]>();
    for (const column of boardState.columns) {
      taskColumns.set(column._id, boardState.tasks
        .filter((task) => task.columnId === column._id)
        .sort((a, b) => a.order - b.order));
    }
    const sourceTasks = taskColumns.get(source.droppableId) ?? [];
    const [task] = sourceTasks.splice(source.index, 1);
    const destinationTasks = source.droppableId === destination.droppableId
      ? sourceTasks
      : taskColumns.get(destination.droppableId) ?? [];
    destinationTasks.splice(destination.index, 0, task);
    taskColumns.set(source.droppableId, sourceTasks);
    taskColumns.set(destination.droppableId, destinationTasks);
    setBoardState({
      columns: boardState.columns,
      tasks: [...taskColumns.entries()].flatMap(([columnId, tasks]) =>
        tasks.map((item, index) => ({ ...item, columnId, order: index })),
      ),
    });
    socket.emit("task:move", {
      boardId: board._id,
      taskId: moved._id,
      columnId: destination.droppableId,
      index: destination.index,
    });
    window.setTimeout(() => {
      if (!socket.connected) setBoardState(oldState);
    }, 5000);
  }

  async function addColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!board || !columnTitle.trim()) return;
    try {
      const { data } = await api.post(`/api/boards/${board._id}/columns`, { title: columnTitle.trim() });
      setBoardState((current) => ({ ...current, columns: [...current.columns, data.column] }));
      setColumnTitle("");
      setAddingColumn(false);
    } catch (requestError: unknown) {
      setNotice(getErrorMessage(requestError, "Could not add that column."));
    }
  }

  async function createSprint() {
    if (!board) return;
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 14);
    const sprintLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(startDate);
    try {
      const { data } = await api.post(`/api/boards/${board._id}/sprints`, {
        title: `Sprint - ${sprintLabel}`,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
      await api.patch(`/api/boards/${board._id}/sprints/${data.sprint._id}/status`, { status: "ACTIVE" });
      const metricResponse = await api.get(`/api/boards/${board._id}/sprints/metrics`);
      setSprint(metricResponse.data.sprint);
      setMetrics(metricResponse.data.metrics);
      setNotice("Your two-week sprint is underway.");
    } catch (requestError: unknown) {
      setNotice(getErrorMessage(requestError, "Could not start a sprint. Check your board permissions."));
    }
  }

  async function createBoard() {
    const title = window.prompt("Name your new project");
    if (!title?.trim()) return;
    try {
      await api.post("/api/boards", { title: title.trim() });
      await refreshBoard();
      setNotice(`"${title.trim()}" is ready.`);
    } catch (requestError: unknown) {
      setNotice(getErrorMessage(requestError, "Could not create that project."));
    }
  }

  async function inviteMember() {
    if (!board) return;
    const email = window.prompt("Enter the email address of an existing TaskFlow member");
    if (!email?.trim()) return;
    try {
      await api.post(`/api/boards/${board._id}/members`, {
        email: email.trim(),
        boardRole: "DEVELOPER",
      });
      setNotice(`Invited ${email.trim()} to the project.`);
    } catch (requestError: unknown) {
      setNotice(getErrorMessage(requestError, "Could not add that member."));
    }
  }

  if (loading) {
    return <div className="loading-screen"><LoaderCircle className="spin" size={26} /> Preparing your workspace...</div>;
  }
  if (!user) return <AuthScreen onSubmit={handleAuth} error={error} setError={setError} />;

  const totalCount = boardState.tasks.length;
  const doneCount = metrics?.completedTasks ?? 0;
  const urgentCount = boardState.tasks.filter((task) => task.priority === "URGENT").length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Command size={19} strokeWidth={2.6} /></div>
          <span>taskflow</span>
          <button className="icon-button sidebar-collapse" aria-label="Collapse navigation"><ChevronDown size={16} /></button>
        </div>
        <button className="workspace-picker">
          <span className="workspace-monogram">{(board?.title ?? "P")[0].toUpperCase()}</span>
          <span className="workspace-copy"><strong>{board?.title ?? "Product workspace"}</strong><small>Workspace</small></span>
          <ChevronDown size={15} />
        </button>
        <nav className="primary-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#board"><LayoutDashboard size={17} /> Overview <span className="nav-kbd">1</span></a>
          <a className="nav-item" href="#board"><Check size={17} /> My tasks</a>
          <a className="nav-item" href="#sprint"><Target size={17} /> Sprints</a>
          <a className="nav-item" href="#board"><CalendarDays size={17} /> Calendar</a>
        </nav>
        <div className="sidebar-section">
          <div className="section-label">YOUR WORKSPACES <button className="icon-button" aria-label="Add workspace"><Plus size={15} /></button></div>
          {boards.map((item, index) => (
            <button
              className={`project-item ${item._id === board?._id ? "current" : ""}`}
              key={item._id}
              onClick={() => void selectBoard(item._id)}
            >
              <span className={`project-dot ${index % 3 === 1 ? "green" : index % 3 === 2 ? "orange" : "violet"}`} />
              {item.title}
              {item._id === board?._id && <span className="project-more">...</span>}
            </button>
          ))}
          <button className="add-project" onClick={() => void createBoard()}><Plus size={15} /> Add project</button>
        </div>
        <div className="sidebar-bottom">
          <a className="nav-item" href="#help"><CircleHelp size={17} /> Help center</a>
          <a className="nav-item" href="#settings"><Settings2 size={17} /> Settings</a>
          <div className="profile">
            <div className="avatar avatar-user">{initials(user.username)}</div>
            <div className="profile-copy"><strong>{user.username}</strong><small>{user.email}</small></div>
            <button className="icon-button" aria-label="Sign out" onClick={logout}><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      <main className="main-panel" id="board">
        <header className="topbar">
          <div className="breadcrumbs"><span>Projects</span><span className="crumb-slash">/</span><strong>{board?.title ?? "Product workspace"}</strong></div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks..." aria-label="Search tasks" />
              <kbd>Ctrl K</kbd>
            </label>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <div className="topbar-divider" />
            <div className={`connection ${connected ? "is-connected" : ""}`} title={connected ? "Live updates connected" : "Reconnecting"}>
              <span className="connection-dot" />{connected ? "Live" : "Offline"}
            </div>
            <div className="avatar-stack" aria-label={`${onlineCount} collaborators online`}>
              <span className="avatar mini-avatar" style={{ background: avatarColors[0] }}>{initials(user.username)}</span>
              {onlineCount > 1 && <span className="avatar mini-avatar online-more">+{onlineCount - 1}</span>}
            </div>
            <button className="share-button" onClick={() => void inviteMember()}><Users size={15} /> Share</button>
          </div>
        </header>

        <div className="page-content">
          {error && <div className="inline-error">{error}</div>}
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-icon"><Sparkles size={12} /></span> TEAM WORKSPACE <span className="eyebrow-dot">/</span> {new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</div>
              <h1>Good morning, {user.username.split(" ")[0]} <span className="wave">+</span></h1>
              <p>Here's what's happening with your team today.</p>
            </div>
            <div className="heading-actions">
              <button className="button button-secondary"><CalendarDays size={15} /> This week <ChevronDown size={14} /></button>
              <Button className="button button-primary" onClick={() => document.getElementById("new-task-button")?.click()}><Plus size={16} /> New task</Button>
            </div>
          </div>

          <section className="stats-grid" aria-label="Workspace summary">
            <StatCard label="Total tasks" value={totalCount} change="Across this board" icon={<LayoutDashboard size={17} />} tone="purple" />
            <StatCard label="Completed" value={doneCount} change={sprint ? `${metrics?.completion ?? 0}% of active sprint` : "No active sprint"} icon={<Check size={17} />} tone="green" />
            <StatCard label="Due this week" value={boardState.tasks.filter((task) => {
              if (!task.dueDate) return false;
              const due = new Date(task.dueDate);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const nextWeek = new Date(today);
              nextWeek.setDate(nextWeek.getDate() + 7);
              return due >= today && due < nextWeek;
            }).length} change="Stay ahead of the curve" icon={<CalendarDays size={17} />} tone="orange" />
            <StatCard label="Urgent priority" value={urgentCount} change={urgentCount ? "Needs your attention" : "All clear for now"} icon={<Flame size={17} />} tone="pink" />
          </section>

          <section className="sprint-panel" id="sprint">
            <div className="sprint-icon"><Target size={18} /></div>
            <div className="sprint-main">
              <div className="sprint-titleline"><strong>{sprint?.title ?? "Current sprint"}</strong><span className="sprint-status"><i /> {sprint ? "IN PROGRESS" : "NO ACTIVE SPRINT"}</span></div>
              <p>{sprint ? "Sprint progress is looking good - keep it up!" : "Create a sprint to start tracking team velocity."}</p>
            </div>
            <div className="sprint-metric"><strong>{metrics?.completion ?? 0}%</strong><span>completion</span></div>
            <div className="sprint-progress"><span style={{ width: `${metrics?.completion ?? 0}%` }} /></div>
            <div className="sprint-metric sprint-velocity"><strong>{metrics?.completedStoryPoints ?? 0}<small> pts</small></strong><span>velocity</span></div>
            <button className="sprint-link" onClick={sprint ? () => setNotice("Sprint metrics are up to date.") : createSprint}>{sprint ? "View sprint" : "Start sprint"} <ArrowUp size={14} /></button>
          </section>

          <div className="board-toolbar">
            <div className="board-title-group"><h2>Project board</h2><span className="task-total">{totalCount} tasks</span></div>
            <div className="board-tools">
              <label className="filter-control"><ListFilter size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value as PriorityFilter)} aria-label="Filter by priority"><option value="ALL">All priorities</option>{priorityOrder.map((priority) => <option key={priority} value={priority}>{priority[0] + priority.slice(1).toLowerCase()}</option>)}</select><ChevronDown size={13} /></label>
              <div className="toolbar-divider" />
              <button className="button button-light" onClick={() => setNotice("Your board is up to date.")}><Activity size={15} /> Activity</button>
            </div>
          </div>

          <DragDropContext onDragEnd={onDragEnd}>
            <div className="kanban-board">
              {boardState.columns.map((column) => {
                const tasks = visibleTasks.filter((task) => task.columnId === column._id).sort((a, b) => a.order - b.order);
                return (
                  <KanbanColumn
                    key={column._id}
                    column={column}
                    columns={boardState.columns}
                    tasks={tasks}
                    allTaskCount={boardState.tasks.filter((task) => task.columnId === column._id).length}
                    isDragDisabled={filter !== "ALL" || search.trim() !== ""}
                    boardId={board?._id ?? ""}
                    onNotice={setNotice}
                  />
                );
              })}
              {addingColumn ? (
                <form className="new-column-form" onSubmit={addColumn}>
                  <input autoFocus value={columnTitle} onChange={(event) => setColumnTitle(event.target.value)} placeholder="Column name" aria-label="Column name" />
                  <div><button className="button button-primary button-small" type="submit">Add column</button><button className="icon-button" type="button" onClick={() => setAddingColumn(false)} aria-label="Cancel"><X size={15} /></button></div>
                </form>
              ) : (
                <button className="add-column-button" onClick={() => setAddingColumn(true)}><Plus size={16} /> Add column</button>
              )}
            </div>
          </DragDropContext>
          <footer className="board-footer"><span><span className={`footer-live-dot ${connected ? "" : "sync-offline"}`} /> {connected ? "Real-time sync active" : "Reconnecting to board..."}</span><span>{totalCount} tasks on this board</span></footer>
        </div>
      </main>
      {notice && <div className="toast" role="status"><Check size={16} />{notice}<button className="icon-button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={14} /></button></div>}
    </div>
  );
}

function AuthScreen({ onSubmit, error, setError }: {
  onSubmit: (event: FormEvent<HTMLFormElement>, mode: AuthMode) => void;
  error: string;
  setError: (message: string) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  return (
    <div className="auth-page">
      <div className="auth-orb orb-one" /><div className="auth-orb orb-two" />
      <section className="auth-card">
        <div className="brand auth-brand"><div className="brand-mark"><Command size={19} strokeWidth={2.6} /></div><span>taskflow</span></div>
        <div className="auth-heading"><span className="auth-sparkle"><Sparkles size={15} /></span><h1>{mode === "login" ? "Welcome back" : "Make work flow"}</h1><p>{mode === "login" ? "Sign in to pick up where your team left off." : "Create your account and set up your first workspace."}</p></div>
        <form className="auth-form" onSubmit={(event) => onSubmit(event, mode)}>
          {mode === "register" && <label>Your name<input name="username" required minLength={2} maxLength={40} placeholder="Alex Morgan" autoComplete="name" /></label>}
          <label>Work email<input name="email" type="email" required autoComplete="email" placeholder="you@company.com" /></label>
          <label>Password<input name="password" type="password" required minLength={8} maxLength={72} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="8-72 characters" /></label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <Button className="button button-primary auth-submit" type="submit">{mode === "login" ? "Sign in to TaskFlow" : "Create your account"}<ArrowUp size={15} /></Button>
        </form>
        <div className="auth-switch">{mode === "login" ? "New to TaskFlow?" : "Already have an account?"}<button onClick={() => { setError(""); setMode(mode === "login" ? "register" : "login"); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></div>
        <div className="auth-footnote"><span><Check size={12} /> Real-time collaboration</span><span>|</span><span>HTTP-only session cookies</span></div>
      </section>
      <div className="auth-quote"><span>"</span><p>Great things are done by a series of small things brought together.</p><small>- Vincent van Gogh</small></div>
    </div>
  );
}

function StatCard({ label, value, change, icon, tone }: {
  label: string;
  value: number;
  change: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return <article className="stat-card">
    <div className={`stat-icon ${tone}`}>{icon}</div>
    <span className="stat-label">{label}</span>
    <div className="stat-value">{value.toString().padStart(2, "0")}</div>
    <span className="stat-change">{change}</span>
  </article>;
}

function KanbanColumn({ column, columns, tasks, allTaskCount, boardId, isDragDisabled, onNotice }: {
  column: Column;
  columns: Column[];
  tasks: Task[];
  allTaskCount: number;
  boardId: string;
  isDragDisabled: boolean;
  onNotice: (message: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/boards/${boardId}/tasks`, { title: title.trim(), columnId: column._id, priority: "MEDIUM" });
      setTitle("");
      setCreating(false);
    } catch (requestError: unknown) {
      onNotice(getErrorMessage(requestError, "Could not create that task."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="kanban-column">
      <div className="column-heading">
        <span className={`column-marker marker-${column.order % 4}`} />
        <h3>{column.title}</h3><span className="column-count">{allTaskCount}</span>
        <button className="icon-button column-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label={`Options for ${column.title}`}>...</button>
        {menuOpen && <div className="column-menu"><span>{allTaskCount} tasks in this column</span><button onClick={() => { setCreating(true); setMenuOpen(false); }}><Plus size={13} /> Add task</button></div>}
      </div>
      <Droppable droppableId={column._id}>
        {(provided, snapshot) => (
          <div className={`task-list ${snapshot.isDraggingOver ? "drag-over" : ""}`} ref={provided.innerRef} {...provided.droppableProps}>
            {tasks.map((task, index) => (
              <Draggable key={task._id} draggableId={task._id} index={index} isDragDisabled={isDragDisabled}>
                {(dragProvided, dragSnapshot) => (
                  <TaskCard
                    task={task}
                    columns={columns}
                    index={index}
                    boardId={boardId}
                    provided={dragProvided}
                    isDragging={dragSnapshot.isDragging}
                    onNotice={onNotice}
                  />
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            {creating && (
              <form className="quick-task-form" onSubmit={createTask}>
                <input id={`new-task-${column._id}`} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" aria-label="New task title" />
                <div><button className="button button-primary button-small" disabled={saving}>{saving ? "Saving..." : "Add task"}</button><button type="button" className="icon-button" onClick={() => setCreating(false)} aria-label="Cancel"><X size={14} /></button></div>
              </form>
            )}
          </div>
        )}
      </Droppable>
      {!creating && <button id={column.order === 0 ? "new-task-button" : undefined} className="column-add-task" onClick={() => setCreating(true)}><Plus size={15} /> Add task</button>}
    </section>
  );
}

function TaskCard({ task, columns, index, boardId, provided, isDragging, onNotice }: {
  task: Task;
  columns: Column[];
  index: number;
  boardId: string;
  provided: Parameters<Parameters<typeof Draggable>[0]["children"]>[0];
  isDragging: boolean;
  onNotice: (message: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [columnValue, setColumnValue] = useState(task.columnId);
  const [priorityValue, setPriorityValue] = useState(task.priority);
  const [saving, setSaving] = useState(false);
  const priority = task.priority.toLowerCase();

  useEffect(() => {
    setTitle(task.title);
    setColumnValue(task.columnId);
    setPriorityValue(task.priority);
  }, [task.title, task.columnId, task.priority]);

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/api/boards/${boardId}/tasks/${task._id}`, {
        title: title.trim(),
        columnId: columnValue,
        priority: priorityValue,
      });
      setEditing(false);
      setMenuOpen(false);
    } catch (requestError: unknown) {
      onNotice(getErrorMessage(requestError, "Could not update that task."));
    } finally {
      setSaving(false);
    }
  }

  async function removeTask() {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/boards/${boardId}/tasks/${task._id}`);
      setMenuOpen(false);
    } catch (requestError: unknown) {
      onNotice(getErrorMessage(requestError, "Could not delete that task."));
    }
  }

  return (
    <article
      className={`task-card ${isDragging ? "is-dragging" : ""}`}
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      aria-label={`Task ${index + 1}: ${task.title}`}
    >
      <div className="task-card-top">
        <Badge className={`priority-badge priority-${priority}`}><i />{priority[0].toUpperCase() + priority.slice(1)}</Badge>
        <button
          className="icon-button task-menu"
          aria-label={`Options for ${task.title}`}
          aria-expanded={menuOpen}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); setMenuOpen(!menuOpen); }}
        >...</button>
        {menuOpen && <div className="task-actions" onMouseDown={(event) => event.stopPropagation()}>
          <button onClick={() => { setEditing(true); setMenuOpen(false); }}>Edit task</button>
          <button className="delete-action" onClick={() => void removeTask()}>Delete task</button>
        </div>}
      </div>
      {editing ? (
        <form className="quick-task-form task-edit-form" onSubmit={saveTask} onMouseDown={(event) => event.stopPropagation()}>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Task title" maxLength={160} />
          <select value={columnValue} onChange={(event) => setColumnValue(event.target.value)} aria-label="Task status">
            {columns.map((column) => <option key={column._id} value={column._id}>{column.title}</option>)}
          </select>
          <select value={priorityValue} onChange={(event) => setPriorityValue(event.target.value as Task["priority"])} aria-label="Task priority">
            {priorityOrder.map((item) => <option key={item} value={item}>{item[0] + item.slice(1).toLowerCase()}</option>)}
          </select>
          <div><button className="button button-primary button-small" disabled={saving}>{saving ? "Saving..." : "Save"}</button><button type="button" className="icon-button" onClick={() => { setTitle(task.title); setColumnValue(task.columnId); setPriorityValue(task.priority); setEditing(false); }} aria-label="Cancel"><X size={14} /></button></div>
        </form>
      ) : <h4>{task.title}</h4>}
      {task.description && <p className="task-description">{task.description}</p>}
      <div className="task-card-bottom">
        <div className="task-meta">{task.dueDate && <span className="due-date"><CalendarDays size={12} />{new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}{(task.storyPoints ?? 0) > 0 && <span className="story-points">{task.storyPoints} pts</span>}</div>
        {task.assignedTo ? <span className="avatar task-assignee" title={task.assignedTo.username}>{initials(task.assignedTo.username)}</span> : <span className="avatar task-assignee unassigned">?</span>}
      </div>
    </article>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ERR_NETWORK"
  ) {
    return `TaskFlow API is unreachable at ${apiBaseUrl}. Start the server and configure MongoDB, then try again.`;
  }
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return fallback;
}

export default App;
