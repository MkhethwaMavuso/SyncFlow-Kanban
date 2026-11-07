import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Link, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { io } from 'socket.io-client';
import {
  Activity as ActivityIcon, ArrowRight, BarChart3, CalendarDays, CheckCheck, CircleHelp, Clock3,
  Command, FolderKanban, LayoutDashboard, LogOut, MessageSquare, MoreHorizontal, Plus, Search, Settings2, Signal, Sparkles, Target,
  Users, X, Zap,
} from 'lucide-react';
import {
  useAddBoardMember, useCreateBoard, useCreateSprint, useCreateTask, useCreateTaskComment,
  useDeleteBoard, useDeleteTask, useGetBoard, useGetBoardAnalytics, useGetCurrentUser, useGetTask,
  useHealthCheck, useListBoardActivity, useListBoards, useListSprints, useListTaskComments,
  useListTasks, useLogin, useLogout, useRegister, useUpdateBoard, useUpdateSprint, useUpdateTask,
  getGetBoardAnalyticsQueryKey, getGetBoardQueryKey, getGetCurrentUserQueryKey, getGetTaskQueryKey,
  getHealthCheckQueryKey, getListBoardActivityQueryKey, getListBoardsQueryKey, getListSprintsQueryKey,
  getListTaskCommentsQueryKey, getListTasksQueryKey,
} from '@workspace/api-client-react';
import type { Activity, Board, BoardAnalytics, BoardMember, Sprint, Task, TaskPriority, TaskStatus, User } from '@workspace/api-client-react';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
const statuses: TaskStatus[] = ['Backlog', 'Todo', 'In Progress', 'Review', 'Done'];
const priorities: TaskPriority[] = ['Low', 'Medium', 'High', 'Urgent'];

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch>
    <Route path="/" component={Entry} />
    <Route path="/login" component={LoginPage} />
    <Route path="/register" component={RegisterPage} />
    <Route path="/dashboard" component={DashboardPage} />
    <Route path="/board/:id" component={BoardPage} />
    <Route path="/analytics/:id" component={AnalyticsPage} />
    <Route component={NotFoundPage} />
  </Switch></ErrorBoundary>;
}

function Entry() {
  const { data, isLoading } = useGetCurrentUser();
  const [, setLocation] = useLocation();
  useEffect(() => { if (!isLoading) setLocation(data ? '/dashboard' : '/login'); }, [data, isLoading, setLocation]);
  return <div className="min-h-[100dvh] grid place-items-center"><div className="text-center"><div className="brand-mark mx-auto mb-4"><Command size={17} /></div><div className="skeleton h-3 w-32 mx-auto" /></div></div>;
}

function Brand({ dark = false }: { dark?: boolean }) {
  return <div className={`brand ${dark ? 'text-white' : ''}`}><span className="brand-mark"><Command size={16} strokeWidth={2.5} /></span><span>syncflow</span><span className="mono text-[9px] tracking-[.12em] text-[#91a09c] ml-[-5px] mt-1">OPS</span></div>;
}

function AppShell({ children, user, active = 'dashboard' }: { children: ReactNode; user?: User; active?: string }) {
  const logout = useLogout();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const doLogout = () => logout.mutate(undefined, { onSuccess: () => { client.removeQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/login'); } });
  return <div className="shell">
    <aside className="sidebar">
      <Brand dark />
      <div className="nav-label">Workspace</div>
      <Link href="/dashboard" className={`nav-item ${active === 'dashboard' ? 'active' : ''}`} data-testid="link-dashboard"><LayoutDashboard size={16} /> Overview</Link>
      <Link href="/dashboard" className="nav-item" data-testid="link-boards"><FolderKanban size={16} /> Boards</Link>
      <div className="nav-label mt-5">Your space</div>
      <div className="px-3 py-2 text-[11px] leading-5 text-[#8e98a3]">Boards, sprint signals and team activity in one place.</div>
      <div className="sidebar-bottom">
        <div className="flex items-center gap-3">
          <Avatar name={user?.name || 'Team member'} url={user?.avatar} />
          <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold">{user?.name || 'Your account'}</div><div className="truncate text-[10px] text-[#939ba5]">{user?.email}</div></div>
          <button className="icon-button text-[#aab0b8]" onClick={doLogout} aria-label="Sign out" data-testid="button-logout"><LogOut size={15} /></button>
        </div>
      </div>
    </aside>
    <main className="main">{children}</main>
  </div>;
}

function Avatar({ name, url, size = 30 }: { name: string; url?: string | null; size?: number }) {
  return url ? <img src={url} alt={name} data-testid="img-avatar" style={{ width: size, height: size }} className="rounded-full object-cover border border-white/70" /> :
    <span data-testid="avatar-initials" style={{ width: size, height: size }} className="rounded-full grid place-items-center bg-[#d9e9e1] text-[#356a59] text-[10px] font-bold border border-white/70 shrink-0">{name.split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase()}</span>;
}

function LoadingPage({ label = 'Loading your workspace' }: { label?: string }) {
  return <div className="space-y-6 fade-up" aria-label={label}><div className="skeleton h-3 w-28" /><div className="skeleton h-9 w-64" /><div className="grid md:grid-cols-3 gap-4"><div className="skeleton h-32" /><div className="skeleton h-32" /><div className="skeleton h-32" /></div><div className="skeleton h-56" /></div>;
}

function ErrorState({ message = 'Something got out of sync.', retry }: { message?: string; retry?: () => void }) {
  return <div className="empty-state"><div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[#f4e7dc] text-[#a45b3a]"><Signal size={18} /></div><div className="font-semibold text-[#363e47]">{message}</div><p className="mt-1 text-xs">Your work is safe. Try loading this view again.</p>{retry && <button onClick={retry} className="button secondary mt-4" data-testid="button-retry">Try again</button>}</div>;
}

function LoginPage() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
  const [, setLocation] = useLocation(); const login = useLogin();
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); login.mutate({ data: { email, password } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/dashboard'); }, onError: (err) => setError(errorMessage(err)) }); };
  return <AuthFrame mode="login"><form onSubmit={submit} className="space-y-5">
    <div><label className="label" htmlFor="email">Work email</label><input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="field" placeholder="you@company.com" required data-testid="input-email" /></div>
    <div><div className="flex justify-between"><label className="label" htmlFor="password">Password</label><span className="text-[11px] text-[#8b8b81]">At least 8 characters</span></div><input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="field" required data-testid="input-password" /></div>
    {error && <div role="alert" className="rounded-lg bg-[#f8e7e3] p-3 text-xs text-[#983e35]" data-testid="status-auth-error">{error}</div>}
    <button className="button w-full !py-3" disabled={login.isPending} data-testid="button-submit-login">{login.isPending ? 'Signing in…' : 'Sign in'}<ArrowRight size={15} /></button>
  </form><div className="mt-6 text-center text-xs text-[#797e81]">New to SyncFlow? <Link href="/register" className="font-semibold text-[#28735f]" data-testid="link-register">Create an account</Link></div></AuthFrame>;
}

function RegisterPage() {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
  const [, setLocation] = useLocation(); const register = useRegister();
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); register.mutate({ data: { name, email, password } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/dashboard'); }, onError: err => setError(errorMessage(err)) }); };
  return <AuthFrame mode="register"><form onSubmit={submit} className="space-y-4">
    <div><label className="label">Your name</label><input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="Morgan Lee" required maxLength={80} data-testid="input-name" /></div>
    <div><label className="label">Work email</label><input className="field" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required data-testid="input-email" /></div>
    <div><label className="label">Password</label><input className="field" type="password" minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required data-testid="input-password" /></div>
    {error && <div role="alert" className="rounded-lg bg-[#f8e7e3] p-3 text-xs text-[#983e35]" data-testid="status-auth-error">{error}</div>}
    <button className="button w-full !py-3" disabled={register.isPending} data-testid="button-submit-register">{register.isPending ? 'Creating workspace…' : 'Create account'}<ArrowRight size={15} /></button>
  </form><div className="mt-6 text-center text-xs text-[#797e81]">Already have an account? <Link href="/login" className="font-semibold text-[#28735f]" data-testid="link-login">Sign in</Link></div></AuthFrame>;
}

function AuthFrame({ children, mode }: { children: ReactNode; mode: 'login' | 'register' }) {
  return <div className="min-h-[100dvh] grid lg:grid-cols-[1.03fr_.97fr] bg-[#f6f3eb]">
    <section className="hidden lg:flex flex-col justify-between bg-[#242a37] p-12 xl:p-16 text-[#f5f1e8] relative overflow-hidden">
      <div className="absolute -right-24 -bottom-24 w-[420px] h-[420px] rounded-full border border-[#56656a]/40" /><div className="absolute right-[-5px] bottom-[-5px] w-[270px] h-[270px] rounded-full border border-[#56656a]/40" />
      <Brand dark />
      <div className="relative max-w-[520px] pb-14">
        <div className="eyebrow !text-[#85b7a7]">A calmer way to move work</div>
        <h1 className="display mt-5 text-[clamp(46px,5.2vw,70px)] leading-[1.02] font-extrabold tracking-[-.06em]">The work is<br />moving. <span className="text-[#8cc6b2]">Stay in sync.</span></h1>
        <p className="mt-6 max-w-[390px] text-[15px] leading-7 text-[#c3c8c8]">One clear view of the work, the people behind it, and the pace you’re keeping together.</p>
        <div className="mt-10 flex items-center gap-4"><div className="flex -space-x-2"><Avatar name="Mira Chen" size={28} /><Avatar name="Ivo Park" size={28} /><Avatar name="Sam Rivera" size={28} /></div><div className="text-[11px] text-[#bac1c0]">Built for teams that work everywhere.</div></div>
      </div>
      <div className="relative flex items-center gap-2 text-[10px] text-[#8b959a]"><span className="h-1.5 w-1.5 rounded-full bg-[#7fc2a8]" />Dependable by design <span className="mx-2">·</span> SyncFlow workspace</div>
    </section>
    <section className="flex items-center justify-center px-5 py-12 lg:px-12">
      <div className="w-full max-w-[390px] fade-up">
        <div className="mb-10 lg:hidden"><Brand /></div>
        <div className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Get your team in motion'}</div>
        <h2 className="display mt-2 mb-2 text-[34px] font-extrabold tracking-[-.05em] text-[#27303c]">{mode === 'login' ? 'Sign in to SyncFlow' : 'Create your account'}</h2>
        <p className="mb-8 text-[13px] text-[#747b7d]">{mode === 'login' ? 'Pick up right where your team left off.' : 'Start with a clear view of what matters.'}</p>
        {children}
        <div className="mt-12 flex justify-center gap-5 text-[10px] text-[#9b9a90]"><span>Private by default</span><span>·</span><span>Made for distributed work</span></div>
      </div>
    </section>
  </div>;
}

function useAuthRedirect() {
  const { data: user, isLoading, isError, refetch } = useGetCurrentUser();
  const [, setLocation] = useLocation();
  useEffect(() => { if (!isLoading && !user) setLocation('/login'); }, [isLoading, user, setLocation]);
  return { user, isLoading, isError, refetch };
}

function DashboardPage() {
  const auth = useAuthRedirect(); const { data: boards, isLoading, isError, refetch } = useListBoards(); const createBoard = useCreateBoard(); const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState(''); const [search, setSearch] = useState('');
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  if (auth.isLoading || isLoading) return <AppShell><LoadingPage /></AppShell>;
  if (auth.isError) return <AuthIssue />;
  if (isError) return <AppShell user={auth.user}><ErrorState retry={() => refetch()} /></AppShell>;
  const visible = (boards || []).filter(b => b.title.toLowerCase().includes(search.toLowerCase()));
  const submit = (e: FormEvent) => { e.preventDefault(); if (!title.trim()) return; createBoard.mutate({ data: { title: title.trim() } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListBoardsQueryKey() }); setTitle(''); setShowCreate(false); } }); };
  return <AppShell user={auth.user}>
    <div className="topline"><div><div className="eyebrow">Your workspace / Monday, May 20</div><h1 className="page-title">Good to have you back<span className="text-[#34806d]">.</span></h1></div><button className="button" onClick={() => setShowCreate(true)} data-testid="button-create-board"><Plus size={16} />New board</button></div>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-8">
      <DashboardMetric label="Boards you’re on" value={boards?.length || 0} icon={<FolderKanban size={16} />} note="Shared workspaces" />
      <DashboardMetric label="Tasks in motion" value={(boards || []).reduce((n, b) => n + Math.max(0, b.taskCount - b.completedCount), 0)} icon={<Zap size={16} />} note="Across your boards" />
      <DashboardMetric label="Completed" value={(boards || []).reduce((n, b) => n + b.completedCount, 0)} icon={<CheckCheck size={16} />} note="A little momentum" />
      <div className="panel metric bg-[#e6eee8] border-[#d6e3d9]"><div className="flex justify-between text-[11px] font-semibold text-[#567267]"><span>Connection</span><span className={`h-2 w-2 rounded-full mt-1 ${health.isError ? 'bg-[#c67660]' : 'bg-[#3e9879]'}`} /></div><div className="metric-value text-[#285948] text-[20px]">{health.isError ? 'Reconnecting' : health.isLoading ? 'Checking…' : 'All systems steady'}</div><div className="mt-1 text-[10px] text-[#71877c]">Workspace status</div></div>
    </div>
    <div className="flex items-end justify-between gap-4 mb-4"><div><div className="eyebrow">Your work</div><h2 className="display mt-1 text-[20px] font-extrabold tracking-[-.04em]">Boards</h2></div><div className="relative w-full max-w-[245px]"><Search size={14} className="absolute left-3 top-3 text-[#9a9c96]" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a board" className="field !pl-9 !py-2 text-xs" data-testid="input-board-search" /></div></div>
    {!visible.length ? <div className="empty-state py-14"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#e3ede7] text-[#377461]"><FolderKanban size={20} /></div><h3 className="display text-lg font-bold text-[#303844]">{boards?.length ? 'No boards match that search' : 'Your first board starts here'}</h3><p className="mx-auto mt-2 max-w-sm text-xs leading-5">{boards?.length ? 'Try a different name or clear the search.' : 'Bring the moving pieces together. Create a board and invite your team into the work.'}</p>{!boards?.length && <button onClick={() => setShowCreate(true)} className="button mt-5" data-testid="button-create-first-board"><Plus size={15} />Create a board</button>}</div> :
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{visible.map((board, i) => <BoardCard key={board.id} board={board} index={i} />)}</div>}
    <div className="mt-9 grid lg:grid-cols-[1fr_310px] gap-5"><RecentActivity boards={boards || []} /><div className="panel p-5 bg-[#ebe9df] border-[#e2ded2]"><div className="flex items-center gap-2 text-[#317561]"><Sparkles size={15} /><span className="eyebrow !text-[#52766a]">A small reminder</span></div><p className="display mt-4 text-[19px] font-bold leading-6 tracking-[-.035em] text-[#333b42]">Keep the next step visible.</p><p className="mt-2 text-xs leading-5 text-[#777d7b]">A clear task, a clear owner, and a shared pace make async work feel easy.</p></div></div>
    {showCreate && <Modal title="Create a board" subtitle="Give your team one shared place to move work forward." close={() => setShowCreate(false)}><form onSubmit={submit} className="space-y-4"><div><label className="label">Board name</label><input autoFocus className="field" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="Product launch" data-testid="input-board-title" required /></div><div className="flex justify-end gap-2"><button type="button" className="button secondary" onClick={() => setShowCreate(false)} data-testid="button-cancel-board">Cancel</button><button disabled={createBoard.isPending} className="button" data-testid="button-save-board">{createBoard.isPending ? 'Creating…' : 'Create board'}<ArrowRight size={14} /></button></div>{createBoard.isError && <div className="text-xs text-red-700">{errorMessage(createBoard.error)}</div>}</form></Modal>}
  </AppShell>;
}

function DashboardMetric({ label, value, icon, note }: { label: string; value: number; icon: ReactNode; note: string }) {
  return <div className="panel metric"><div className="flex items-center justify-between text-[11px] text-[#737a7b]"><span>{label}</span><span className="text-[#36806d]">{icon}</span></div><div className="metric-value">{value}</div><div className="mt-1 text-[10px] text-[#969990]">{note}</div></div>;
}

function BoardCard({ board, index }: { board: Board; index: number }) {
  const rate = board.taskCount ? Math.round(board.completedCount / board.taskCount * 100) : 0;
  const colors = ['#39816d', '#c27b59', '#567d91', '#9a8050'];
  return <Link href={`/board/${board.id}`} className="panel p-5 block no-underline text-inherit hover:-translate-y-0.5 transition-transform fade-up" style={{ animationDelay: `${index * 60}ms` }} data-testid={`card-board-${board.id}`}>
    <div className="flex justify-between items-start"><div className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: colors[index % colors.length] }}><FolderKanban size={17} /></div><button aria-label={`Open ${board.title}`} className="icon-button"><MoreHorizontal size={18} /></button></div>
    <h3 className="display mt-5 text-[17px] font-extrabold tracking-[-.035em]" data-testid={`text-board-title-${board.id}`}>{board.title}</h3>
    <div className="mt-1 text-[11px] text-[#878b86]">{board.members.length} {board.members.length === 1 ? 'person' : 'people'} · Updated {relativeTime(board.updatedAt)}</div>
    <div className="mt-5 flex items-center justify-between text-[10px] text-[#7b807c]"><span>{board.completedCount} of {board.taskCount} tasks completed</span><span className="mono">{rate}%</span></div>
    <div className="bar mt-2"><span style={{ width: `${rate}%` }} /></div>
    <div className="mt-4 flex items-center justify-between"><div className="flex -space-x-2">{board.members.slice(0, 4).map(m => <Avatar key={m.id} name={m.name} url={m.avatar} size={25} />)}{board.members.length > 4 && <span className="grid h-[25px] w-[25px] place-items-center rounded-full bg-[#efede5] text-[9px] text-[#686d6b] border border-white">+{board.members.length - 4}</span>}</div><span className="text-[10px] font-semibold text-[#387865] flex items-center gap-1">Open board <ArrowRight size={12} /></span></div>
  </Link>;
}

function RecentActivity({ boards }: { boards: Board[] }) {
  return <div className="panel px-5 pt-5 pb-2"><div className="flex items-center justify-between"><div><div className="eyebrow">The latest</div><h2 className="display mt-1 text-[18px] font-extrabold tracking-[-.04em]">Recent activity</h2></div><ActivityIcon size={17} className="text-[#43806e]" /></div>
    {boards.length ? <div className="mt-3 grid md:grid-cols-2 gap-x-8"><ActivityCollection board={boards[0]} /><ActivityCollection board={boards[1]} /></div> : <p className="py-6 text-xs text-[#80837e]">Board activity will show up here once you get started.</p>}
  </div>;
}

function ActivityCollection({ board }: { board?: Board }) {
  const { data } = useListBoardActivity(board?.id || 0, { limit: 3 }, { query: { enabled: !!board, queryKey: getListBoardActivityQueryKey(board?.id || 0, { limit: 3 }) } });
  if (!board) return null;
  return <div>{(data || []).slice(0, 3).map(item => <div key={item.id} className="activity-row" data-testid={`activity-${item.id}`}><div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-[#e2ebe5] grid place-items-center text-[#397461] text-[9px] font-bold">{initials(item.actorName)}</div><div className="min-w-0 flex-1"><div className="text-[#484e52]"><b className="font-semibold">{item.actorName}</b> {item.action} <span className="font-semibold">{item.target}</span></div><div className="mt-1 text-[10px] text-[#999b93]">{board.title} · {relativeTime(item.createdAt)}</div></div></div>)}</div>;
}

function BoardPage() {
  const params = useParams<{ id: string }>(); const boardId = Number(params.id);
  const auth = useAuthRedirect(); const { data: board, isLoading: boardLoading, isError: boardError, refetch: refetchBoard } = useGetBoard(boardId, { query: { queryKey: getGetBoardQueryKey(boardId), enabled: Number.isFinite(boardId) } });
  const { data: tasks, isLoading: taskLoading, isError: taskError, refetch: refetchTasks } = useListTasks(boardId, undefined, { query: { queryKey: getListTasksQueryKey(boardId), enabled: Number.isFinite(boardId) } });
  const { data: sprints } = useListSprints(boardId, { query: { queryKey: getListSprintsQueryKey(boardId), enabled: Number.isFinite(boardId) } });
  const { data: activity } = useListBoardActivity(boardId, { limit: 20 }, { query: { queryKey: getListBoardActivityQueryKey(boardId, { limit: 20 }), enabled: Number.isFinite(boardId) } });
  const client = useQueryClient(); const [, setLocation] = useLocation();
  const [filters, setFilters] = useState({ search: '', priority: '', assignee: '', sprint: '' });
  const [taskModal, setTaskModal] = useState<{ open: boolean; task?: Task }>({ open: false });
  const [boardMenu, setBoardMenu] = useState(false); const [memberModal, setMemberModal] = useState(false); const [sprintModal, setSprintModal] = useState(false);
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    if (!Number.isFinite(boardId)) return;
    const socket = io({ withCredentials: true, autoConnect: true });
    const refresh = () => { client.invalidateQueries({ queryKey: getGetBoardQueryKey(boardId) }); client.invalidateQueries({ queryKey: getListTasksQueryKey(boardId) }); client.invalidateQueries({ queryKey: getListSprintsQueryKey(boardId) }); client.invalidateQueries({ queryKey: getListBoardActivityQueryKey(boardId, { limit: 20 }) }); setFresh(true); };
    socket.on('connect', refresh); socket.on('disconnect', () => setFresh(false)); socket.onAny((_event) => refresh());
    return () => { socket.off('connect', refresh); socket.offAny(); socket.disconnect(); };
  }, [boardId, client]);
  const visibleTasks = useMemo(() => (tasks || []).filter(task => {
    const matchedSearch = task.title.toLowerCase().includes(filters.search.toLowerCase()) || (task.description || '').toLowerCase().includes(filters.search.toLowerCase());
    return matchedSearch && (!filters.priority || task.priority === filters.priority) && (!filters.assignee || String(task.assigneeId || '') === filters.assignee) && (!filters.sprint || String(task.sprintId || '') === filters.sprint);
  }), [tasks, filters]);
  if (auth.isLoading || boardLoading || taskLoading) return <AppShell><LoadingPage label="Loading board" /></AppShell>;
  if (!auth.user) return null;
  if (boardError || taskError || !board) return <AppShell user={auth.user}><ErrorState message="This board could not be loaded." retry={() => { refetchBoard(); refetchTasks(); }} /></AppShell>;
  const activeSprint = (sprints || []).find(s => s.status === 'Active');
  return <AppShell user={auth.user} active="boards">
    <div className="topline mb-6"><div className="min-w-0"><div className="eyebrow">Boards / {board.title}</div><div className="flex items-center gap-3 mt-2"><h1 className="page-title !mt-0 truncate" data-testid="text-board-heading">{board.title}</h1><div className="relative"><button className="icon-button" onClick={() => setBoardMenu(v => !v)} aria-label="Board controls" data-testid="button-board-menu"><MoreHorizontal size={20} /></button>{boardMenu && <BoardActions board={board} onClose={() => setBoardMenu(false)} onDeleted={() => setLocation('/dashboard')} />}</div></div></div>
      <div className="flex items-center gap-2 shrink-0"><div className="hidden sm:flex -space-x-2 mr-2">{board.members.slice(0, 4).map(m => <Avatar key={m.id} name={m.name} url={m.avatar} size={28} />)}</div><button className="button secondary !py-2" onClick={() => setMemberModal(true)} data-testid="button-add-member"><Users size={14} />Invite</button><Link href={`/analytics/${board.id}`} className="button !py-2" data-testid="link-analytics"><BarChart3 size={14} />Insights</Link></div></div>
    {activeSprint && <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#d4e3da] bg-[#e8f0e9] px-4 py-3"><div className="grid h-8 w-8 place-items-center rounded-lg bg-[#d4e6da] text-[#2f755e]"><Target size={16} /></div><div className="flex-1"><div className="text-[11px] font-bold text-[#345c4d]">{activeSprint.name} <span className="pill ml-2 !bg-[#d4e7d8] !text-[#39735d]">Active sprint</span></div><div className="mt-1 text-[10px] text-[#75877c]">{activeSprint.goal || 'Keep work moving toward the sprint goal.'}</div></div><div className="mono text-[10px] text-[#638071]">{activeSprint.completedCount}/{activeSprint.taskCount} complete</div></div>}
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px] max-w-[280px]"><Search size={14} className="absolute left-3 top-3 text-[#9a9c96]" /><input value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} placeholder="Search tasks" className="field !pl-9 !py-2 text-xs" data-testid="input-task-search" /></div>
      <select className="field !w-auto !py-2 text-xs" value={filters.priority} onChange={e => setFilters({ ...filters, priority: e.target.value })} data-testid="filter-priority"><option value="">All priorities</option>{priorities.map(p => <option key={p}>{p}</option>)}</select>
      <select className="field !w-auto !py-2 text-xs" value={filters.assignee} onChange={e => setFilters({ ...filters, assignee: e.target.value })} data-testid="filter-assignee"><option value="">All people</option>{board.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <select className="field !w-auto !py-2 text-xs" value={filters.sprint} onChange={e => setFilters({ ...filters, sprint: e.target.value })} data-testid="filter-sprint"><option value="">All sprints</option>{(sprints || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <div className="ml-auto flex items-center gap-2"><button className="button secondary !py-2" onClick={() => setSprintModal(true)} data-testid="button-create-sprint"><CalendarDays size={14} />Sprint</button><button className="button !py-2" onClick={() => setTaskModal({ open: true })} data-testid="button-create-task"><Plus size={15} />New task</button></div>
    </div>
    <div className="flex items-center justify-between text-[10px] text-[#878b84] mb-3"><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${fresh ? 'bg-[#41947a]' : 'bg-[#c68157]'}`} /><span data-testid="status-live">{fresh ? 'Live updates on' : 'Reconnecting to live updates'}</span></div><span>{visibleTasks.length} tasks shown</span></div>
    <div className="kanban-wrap"><div className="flex gap-3 min-w-max">
      {statuses.map((status, index) => <KanbanColumn key={status} status={status} tasks={visibleTasks.filter(t => t.status === status)} allCount={(tasks || []).filter(t => t.status === status).length} index={index} boardId={board.id} onOpen={task => setTaskModal({ open: true, task })} members={board.members} />)}
    </div></div>
    <div className="mt-7 grid lg:grid-cols-[1fr_300px] gap-5"><div className="panel p-5"><div className="flex justify-between items-center"><div><div className="eyebrow">Team pulse</div><h2 className="display mt-1 text-[17px] font-extrabold tracking-[-.04em]">Latest on this board</h2></div><ActivityIcon size={16} className="text-[#42816e]" /></div>{activity?.length ? activity.slice(0, 4).map(a => <ActivityLine key={a.id} item={a} />) : <p className="mt-4 text-xs text-[#8a8e88]">Team updates will appear here.</p>}</div>
      <div className="panel p-5"><div className="eyebrow">Board team</div><div className="display mt-1 text-[17px] font-extrabold tracking-[-.04em]">{board.members.length} collaborators</div><div className="mt-4 space-y-3">{board.members.slice(0, 5).map(m => <div key={m.id} className="flex items-center gap-3"><Avatar name={m.name} url={m.avatar} size={30} /><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{m.name}</div><div className="truncate text-[10px] text-[#92958e]">{m.email}</div></div><span className="pill">{m.role}</span></div>)}</div></div>
    </div>
    {taskModal.open && <TaskModal boardId={board.id} members={board.members} sprints={sprints || []} task={taskModal.task} close={() => setTaskModal({ open: false })} />}
    {memberModal && <MemberModal boardId={board.id} close={() => setMemberModal(false)} />}
    {sprintModal && <SprintModal boardId={board.id} close={() => setSprintModal(false)} />}
  </AppShell>;
}

function KanbanColumn({ status, tasks, allCount, index, boardId, onOpen, members }: { status: TaskStatus; tasks: Task[]; allCount: number; index: number; boardId: number; onOpen: (task: Task) => void; members: BoardMember[] }) {
  const updateTask = useUpdateTask(); const client = useQueryClient(); const [dragOver, setDragOver] = useState(false);
  const color = ['#879188', '#64859a', '#d08b50', '#967c9b', '#41836e'][index];
  const move = (taskId: number) => updateTask.mutate({ taskId, data: { status, position: tasks.length } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListTasksQueryKey(boardId) }); client.invalidateQueries({ queryKey: getGetBoardQueryKey(boardId) }); client.invalidateQueries({ queryKey: getGetBoardAnalyticsQueryKey(boardId) }); } });
  return <section className={`kanban-column ${dragOver ? 'ring-2 ring-[#4c9a82]' : ''}`} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); const id = Number(e.dataTransfer.getData('text/task-id')); if (id) move(id); setDragOver(false); }} data-testid={`column-${status.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="column-title"><span className="flex items-center gap-2"><span className="status-dot" style={{ background: color }} />{status}</span><span className="mono text-[10px] text-[#858a85]">{allCount}</span></div>
    <div className="space-y-2">{tasks.map(task => <TaskCard key={task.id} task={task} members={members} onOpen={() => onOpen(task)} />)}</div>
    {tasks.length === 0 && <div className="rounded-lg border border-dashed border-[#d4d0c6] py-8 text-center text-[10px] text-[#9a9c94]">Drop tasks here</div>}
  </section>;
}

function TaskCard({ task, members, onOpen }: { task: Task; members: BoardMember[]; onOpen: () => void }) {
  const person = members.find(m => m.id === task.assigneeId);
  return <article draggable onDragStart={e => e.dataTransfer.setData('text/task-id', String(task.id))} onClick={onOpen} className="task-card" data-testid={`card-task-${task.id}`}>
    <div className="flex justify-between items-center"><span className={`pill priority-${task.priority.toLowerCase()}`}>{task.priority}</span><button className="icon-button !p-1" onClick={e => { e.stopPropagation(); onOpen(); }} aria-label="Open task details" data-testid={`button-task-menu-${task.id}`}><MoreHorizontal size={15} /></button></div>
    <h3 className="mt-2.5 text-[12px] font-semibold leading-[1.45] text-[#333b45]" data-testid={`text-task-title-${task.id}`}>{task.title}</h3>
    {task.description && <p className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-[#8a8d88]">{task.description}</p>}
    <div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-1.5 text-[10px] text-[#969890]">{task.dueDate && <><CalendarDays size={12} />{formatDate(task.dueDate)}</>}{task.commentCount > 0 && <span className="ml-2 flex items-center gap-1"><MessageSquare size={11} />{task.commentCount}</span>}</div>{person && <Avatar name={person.name} url={person.avatar} size={22} />}</div>
  </article>;
}

function TaskModal({ boardId, members, sprints, task, close }: { boardId: number; members: BoardMember[]; sprints: Sprint[]; task?: Task; close: () => void }) {
  const isEdit = !!task; const taskQuery = useGetTask(task?.id || 0, { query: { enabled: !!task, queryKey: getGetTaskQueryKey(task?.id || 0) } });
  const liveTask = taskQuery.data || task;
  const commentsQuery = useListTaskComments(task?.id || 0, { query: { enabled: !!task, queryKey: getListTaskCommentsQueryKey(task?.id || 0) } });
  const createTask = useCreateTask(); const updateTask = useUpdateTask(); const deleteTask = useDeleteTask(); const createComment = useCreateTaskComment(); const client = useQueryClient();
  const [title, setTitle] = useState(task?.title || ''); const [description, setDescription] = useState(task?.description || '');
  const [status, setStatus] = useState<TaskStatus>(task?.status || 'Todo'); const [priority, setPriority] = useState<TaskPriority>(task?.priority || 'Medium');
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ? String(task.assigneeId) : ''); const [dueDate, setDueDate] = useState(task?.dueDate?.slice(0, 10) || ''); const [sprintId, setSprintId] = useState(task?.sprintId ? String(task.sprintId) : '');
  const [comment, setComment] = useState(''); const [error, setError] = useState('');
  const reload = () => { client.invalidateQueries({ queryKey: getListTasksQueryKey(boardId) }); client.invalidateQueries({ queryKey: getGetBoardQueryKey(boardId) }); client.invalidateQueries({ queryKey: getGetBoardAnalyticsQueryKey(boardId) }); };
  useEffect(() => { if (liveTask) { setTitle(liveTask.title); setDescription(liveTask.description || ''); setStatus(liveTask.status); setPriority(liveTask.priority); setAssigneeId(liveTask.assigneeId ? String(liveTask.assigneeId) : ''); setDueDate(liveTask.dueDate?.slice(0, 10) || ''); setSprintId(liveTask.sprintId ? String(liveTask.sprintId) : ''); } }, [liveTask?.id]);
  const save = (e: FormEvent) => {
    e.preventDefault(); setError('');
    const data = { title: title.trim(), description, status, priority, assigneeId: assigneeId ? Number(assigneeId) : null, dueDate: dueDate || null, sprintId: sprintId ? Number(sprintId) : null };
    if (!data.title) return;
    if (task) updateTask.mutate({ taskId: task.id, data }, { onSuccess: () => { reload(); close(); }, onError: err => setError(errorMessage(err)) });
    else createTask.mutate({ boardId, data }, { onSuccess: () => { reload(); close(); }, onError: err => setError(errorMessage(err)) });
  };
  const remove = () => { if (task && window.confirm(`Delete “${task.title}”? This cannot be undone.`)) deleteTask.mutate({ taskId: task.id }, { onSuccess: () => { reload(); close(); }, onError: err => setError(errorMessage(err)) }); };
  const addComment = (e: FormEvent) => { e.preventDefault(); if (!task || !comment.trim()) return; createComment.mutate({ taskId: task.id, data: { body: comment.trim() } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListTaskCommentsQueryKey(task.id) }); client.invalidateQueries({ queryKey: getListTasksQueryKey(boardId) }); setComment(''); }, onError: err => setError(errorMessage(err)) }); };
  return <Modal title={task ? 'Task details' : 'New task'} subtitle={task ? 'Keep the next action clear for everyone.' : 'Add a task to this board.'} close={close}>
    {task && taskQuery.isLoading ? <LoadingPage label="Loading task" /> : <form onSubmit={save} className="space-y-4">
      <div><label className="label">Task title</label><input className="field" autoFocus maxLength={180} value={title} onChange={e => setTitle(e.target.value)} required data-testid="input-task-title" /></div>
      <div><label className="label">Description</label><textarea className="field min-h-[86px] resize-y" maxLength={5000} value={description} onChange={e => setDescription(e.target.value)} placeholder="What does done look like?" data-testid="input-task-description" /></div>
      <div className="grid sm:grid-cols-2 gap-3"><div><label className="label">Status</label><select className="field" value={status} onChange={e => setStatus(e.target.value as TaskStatus)} data-testid="select-task-status">{statuses.map(s => <option key={s}>{s}</option>)}</select></div><div><label className="label">Priority</label><select className="field" value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} data-testid="select-task-priority">{priorities.map(p => <option key={p}>{p}</option>)}</select></div>
        <div><label className="label">Assignee</label><select className="field" value={assigneeId} onChange={e => setAssigneeId(e.target.value)} data-testid="select-task-assignee"><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div><div><label className="label">Due date</label><input type="date" className="field" value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="input-task-due-date" /></div>
        <div className="sm:col-span-2"><label className="label">Sprint</label><select className="field" value={sprintId} onChange={e => setSprintId(e.target.value)} data-testid="select-task-sprint"><option value="">No sprint</option>{sprints.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></div></div>
      {error && <p className="text-xs text-red-700" role="alert" data-testid="status-task-error">{error}</p>}
      <div className="flex items-center justify-between border-t border-[#e9e5dc] pt-4"><div>{task && <button type="button" className="button danger !py-2" onClick={remove} disabled={deleteTask.isPending} data-testid="button-delete-task">Delete task</button>}</div><div className="flex gap-2"><button type="button" className="button secondary" onClick={close} data-testid="button-cancel-task">Cancel</button><button disabled={createTask.isPending || updateTask.isPending} className="button" data-testid="button-save-task">{createTask.isPending || updateTask.isPending ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button></div></div>
    </form>}
    {task && <div className="mt-6 border-t border-[#e9e5dc] pt-5"><div className="mb-3 flex items-center gap-2 text-xs font-bold text-[#38414a]"><MessageSquare size={14} className="text-[#45806e]" />Comments <span className="pill">{commentsQuery.data?.length || 0}</span></div>
      {commentsQuery.isLoading ? <div className="skeleton h-12" /> : commentsQuery.isError ? <div className="text-xs text-[#9a5147]">Comments could not be loaded.</div> : <div className="max-h-40 overflow-auto">{(commentsQuery.data || []).map(c => <div key={c.id} className="mb-3 flex gap-2.5" data-testid={`comment-${c.id}`}><Avatar name={c.authorName} size={25} /><div className="flex-1 rounded-lg bg-[#f1efe8] px-3 py-2"><div className="flex justify-between gap-2"><b className="text-[10px]">{c.authorName}</b><span className="text-[9px] text-[#9a9b94]">{relativeTime(c.createdAt)}</span></div><p className="mt-1 text-[11px] leading-4 text-[#656b6c]">{c.body}</p></div></div>)}</div>}
      <form onSubmit={addComment} className="mt-3 flex gap-2"><input className="field !py-2 text-xs" value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment…" maxLength={3000} data-testid="input-task-comment" /><button className="button !px-3 !py-2" disabled={!comment.trim() || createComment.isPending} data-testid="button-submit-comment">Post</button></form>
    </div>}
  </Modal>;
}

function BoardActions({ board, onClose, onDeleted }: { board: Board; onClose: () => void; onDeleted: () => void }) {
  const update = useUpdateBoard(); const remove = useDeleteBoard(); const client = useQueryClient(); const [editing, setEditing] = useState(false); const [title, setTitle] = useState(board.title);
  const submit = (e: FormEvent) => { e.preventDefault(); update.mutate({ boardId: board.id, data: { title } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetBoardQueryKey(board.id) }); client.invalidateQueries({ queryKey: getListBoardsQueryKey() }); setEditing(false); onClose(); } }); };
  const del = () => { if (window.confirm(`Delete “${board.title}” and its work? This cannot be undone.`)) remove.mutate({ boardId: board.id }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListBoardsQueryKey() }); onDeleted(); } }); };
  return <div className="absolute z-10 right-0 top-8 w-56 rounded-xl border border-[#e4dfd5] bg-[#fffefa] p-3 shadow-xl">
    {editing ? <form onSubmit={submit}><label className="label">Board name</label><input value={title} onChange={e => setTitle(e.target.value)} className="field !py-2" maxLength={120} data-testid="input-rename-board" /><div className="mt-2 flex justify-end gap-2"><button className="button secondary !py-1.5" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="button !py-1.5" data-testid="button-save-board-name">Save</button></div></form> : <><button className="w-full rounded-md px-3 py-2 text-left text-xs hover:bg-[#f0eee7]" onClick={() => setEditing(true)} data-testid="button-rename-board"><Settings2 size={13} className="inline mr-2" />Rename board</button><button className="w-full rounded-md px-3 py-2 text-left text-xs text-[#a4483e] hover:bg-[#f8e9e5]" onClick={del} data-testid="button-delete-board"><X size={13} className="inline mr-2" />Delete board</button></>}
    {remove.isError && <p className="px-2 pt-2 text-[10px] text-red-700">{errorMessage(remove.error)}</p>}
  </div>;
}

function MemberModal({ boardId, close }: { boardId: number; close: () => void }) {
  const [email, setEmail] = useState(''); const [error, setError] = useState(''); const add = useAddBoardMember(); const client = useQueryClient();
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); add.mutate({ boardId, data: { email } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetBoardQueryKey(boardId) }); client.invalidateQueries({ queryKey: getListBoardsQueryKey() }); close(); }, onError: err => setError(errorMessage(err)) }); };
  return <Modal title="Invite a teammate" subtitle="Add a registered SyncFlow user to this board." close={close}><form onSubmit={submit} className="space-y-4"><div><label className="label">Teammate’s email</label><input className="field" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@company.com" data-testid="input-member-email" /></div>{error && <p className="text-xs text-red-700" role="alert">{error}</p>}<div className="flex justify-end gap-2"><button type="button" className="button secondary" onClick={close}>Cancel</button><button disabled={add.isPending} className="button" data-testid="button-submit-member">{add.isPending ? 'Adding…' : 'Add to board'}</button></div></form></Modal>;
}

function SprintModal({ boardId, close }: { boardId: number; close: () => void }) {
  const create = useCreateSprint(); const update = useUpdateSprint(); const { data: sprints } = useListSprints(boardId, { query: { queryKey: getListSprintsQueryKey(boardId) } }); const client = useQueryClient();
  const [name, setName] = useState(''); const [goal, setGoal] = useState(''); const [startDate, setStartDate] = useState(''); const [endDate, setEndDate] = useState(''); const [error, setError] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); create.mutate({ boardId, data: { name, goal, startDate, endDate } }, { onSuccess: sprint => { client.invalidateQueries({ queryKey: getListSprintsQueryKey(boardId) }); if (!(sprints || []).some(s => s.status === 'Active')) update.mutate({ sprintId: sprint.id, data: { status: 'Active' } }, { onSuccess: () => client.invalidateQueries({ queryKey: getListSprintsQueryKey(boardId) }) }); close(); }, onError: err => setError(errorMessage(err)) }); };
  return <Modal title="Plan a sprint" subtitle="Set the window and the outcome your team is aiming for." close={close}><form onSubmit={submit} className="space-y-4"><div><label className="label">Sprint name</label><input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="Sprint 12" required maxLength={120} data-testid="input-sprint-name" /></div><div><label className="label">Sprint goal</label><textarea className="field min-h-[72px]" value={goal} onChange={e => setGoal(e.target.value)} placeholder="What should be true by the end?" maxLength={1000} data-testid="input-sprint-goal" /></div><div className="grid grid-cols-2 gap-3"><div><label className="label">Starts</label><input className="field" type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-sprint-start" /></div><div><label className="label">Ends</label><input className="field" type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="input-sprint-end" /></div></div>{error && <p className="text-xs text-red-700">{error}</p>}<div className="flex justify-end gap-2"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button" disabled={create.isPending} data-testid="button-submit-sprint">{create.isPending ? 'Creating…' : 'Create sprint'}</button></div></form></Modal>;
}

function AnalyticsPage() {
  const params = useParams<{ id: string }>(); const boardId = Number(params.id); const auth = useAuthRedirect();
  const board = useGetBoard(boardId, { query: { queryKey: getGetBoardQueryKey(boardId), enabled: Number.isFinite(boardId) } });
  const analytics = useGetBoardAnalytics(boardId, { query: { queryKey: getGetBoardAnalyticsQueryKey(boardId), enabled: Number.isFinite(boardId) } });
  const sprints = useListSprints(boardId, { query: { queryKey: getListSprintsQueryKey(boardId), enabled: Number.isFinite(boardId) } });
  const updateSprint = useUpdateSprint(); const client = useQueryClient();
  if (auth.isLoading || board.isLoading || analytics.isLoading) return <AppShell><LoadingPage label="Loading analytics" /></AppShell>;
  if (!auth.user) return null;
  if (board.isError || analytics.isError || !board.data || !analytics.data) return <AppShell user={auth.user}><ErrorState message="Delivery signals are unavailable." retry={() => { board.refetch(); analytics.refetch(); }} /></AppShell>;
  const a = analytics.data; const remaining = Math.max(0, a.totalTasks - a.completedTasks);
  return <AppShell user={auth.user} active="boards">
    <div className="topline"><div><div className="eyebrow"><Link href={`/board/${boardId}`} className="text-[#727b77] hover:text-[#267360]" data-testid="link-back-board">Boards / {board.data.title}</Link> / Delivery</div><h1 className="page-title">Sprint signals<span className="text-[#34806d]">.</span></h1></div><Link href={`/board/${boardId}`} className="button secondary" data-testid="link-return-board"><FolderKanban size={14} />Back to board</Link></div>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
      <DashboardMetric label="Completion rate" value={Math.round(a.completionRate)} icon={<Target size={16} />} note="Tasks completed" />
      <DashboardMetric label="Completed" value={a.completedTasks} icon={<CheckCheck size={16} />} note="All time on this board" />
      <DashboardMetric label="Active work" value={a.activeTasks} icon={<Zap size={16} />} note="Currently in motion" />
      <div className="panel metric bg-[#f5e8de] border-[#ead9ca]"><div className="flex items-center justify-between text-[11px] text-[#966343]"><span>Overdue</span><Clock3 size={16} /></div><div className="metric-value text-[#984f39]">{a.overdueTasks}</div><div className="mt-1 text-[10px] text-[#a77e64]">Worth a second look</div></div>
    </div>
    <div className="grid xl:grid-cols-[1.5fr_1fr] gap-5 mb-5">
      <section className="panel p-5"><div className="flex items-start justify-between"><div><div className="eyebrow">Delivery rhythm</div><h2 className="display mt-1 text-[19px] font-extrabold tracking-[-.04em]">Weekly completed tasks</h2></div><span className="pill">Recent weeks</span></div><VelocityChart analytics={a} /></section>
      <section className="panel p-5"><div className="eyebrow">Work mix</div><h2 className="display mt-1 text-[19px] font-extrabold tracking-[-.04em]">Priority distribution</h2><div className="mt-6 space-y-4">{priorities.slice().reverse().map(priority => { const count = a.priorityCounts[priority]; const percent = a.totalTasks ? count / a.totalTasks * 100 : 0; return <div key={priority}><div className="mb-1.5 flex items-center justify-between text-xs"><span className={`pill priority-${priority.toLowerCase()}`}>{priority}</span><span className="mono text-[10px] text-[#777d7c]">{count}</span></div><div className="bar"><span style={{ width: `${percent}%`, background: priority === 'Urgent' ? '#c4624f' : priority === 'High' ? '#ce8955' : priority === 'Medium' ? '#b8a64d' : '#559078' }} /></div></div>; })}</div><div className="mt-6 rounded-lg bg-[#f1efe8] p-3 text-[10px] text-[#81847f]">{remaining} tasks still open out of {a.totalTasks} total.</div></section>
    </div>
    <section className="panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Planning cadence</div><h2 className="display mt-1 text-[19px] font-extrabold tracking-[-.04em]">Sprints</h2></div><span className="pill">{sprints.data?.length || 0} total</span></div>
      {sprints.isLoading ? <div className="skeleton mt-5 h-20" /> : !sprints.data?.length ? <div className="empty-state mt-5">No sprints have been planned on this board.</div> : <div className="mt-4 divide-y divide-[#ece8df]">{sprints.data.map(s => <SprintRow key={s.id} sprint={s} onStatus={status => updateSprint.mutate({ sprintId: s.id, data: { status } }, { onSuccess: () => client.invalidateQueries({ queryKey: getListSprintsQueryKey(boardId) }) })} />)}</div>}
    </section>
  </AppShell>;
}

function VelocityChart({ analytics }: { analytics: BoardAnalytics }) {
  const values = analytics.weeklyCompleted || []; const max = Math.max(1, ...values.map(v => v.completed));
  return <div className="mt-5"><div className="flex h-[180px] items-end gap-3 border-b border-l border-[#e7e3d9] px-3 pb-0 pt-4">{values.length ? values.map((point, i) => <div key={`${point.week}-${i}`} className="group flex h-full flex-1 flex-col items-center justify-end gap-2"><div className="mono text-[9px] text-[#6d746f]">{point.completed}</div><div className="w-full max-w-[42px] rounded-t-md bg-[#72a28c] transition-all group-hover:bg-[#347862]" style={{ height: `${Math.max(4, point.completed / max * 72)}%` }} title={`${point.completed} completed`} /><span className="mb-[-20px] mt-1 whitespace-nowrap text-[9px] text-[#888d87]">{point.week}</span></div>) : <div className="mb-6 w-full text-center text-xs text-[#8c9089]">Weekly delivery data will appear as tasks are completed.</div>}</div><div className="mt-7 flex items-center justify-between text-[10px] text-[#8e918a]"><span>Tasks completed per week</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#72a28c]" />Delivered</span></div></div>;
}

function SprintRow({ sprint, onStatus }: { sprint: Sprint; onStatus: (s: 'Planned' | 'Active' | 'Completed') => void }) {
  const percent = sprint.taskCount ? Math.round(sprint.completedCount / sprint.taskCount * 100) : 0;
  return <div className="flex flex-wrap items-center gap-4 py-4" data-testid={`row-sprint-${sprint.id}`}><div className={`grid h-9 w-9 place-items-center rounded-lg ${sprint.status === 'Active' ? 'bg-[#dcece2] text-[#33765f]' : 'bg-[#f0eee7] text-[#858a83]'}`}><CalendarDays size={15} /></div><div className="min-w-[145px] flex-1"><div className="text-xs font-bold">{sprint.name}<span className="pill ml-2">{sprint.status}</span></div><div className="mt-1 text-[10px] text-[#92958e]">{formatDate(sprint.startDate)} — {formatDate(sprint.endDate)}{sprint.goal ? ` · ${sprint.goal}` : ''}</div></div><div className="w-[160px]"><div className="flex justify-between text-[9px] text-[#828780]"><span>{sprint.completedCount}/{sprint.taskCount} tasks</span><span>{percent}%</span></div><div className="bar mt-1"><span style={{ width: `${percent}%` }} /></div></div><div className="flex gap-1">{sprint.status === 'Planned' && <button className="button !py-1.5 !px-2 text-[10px]" onClick={() => onStatus('Active')} data-testid={`button-start-sprint-${sprint.id}`}>Start</button>}{sprint.status === 'Active' && <button className="button secondary !py-1.5 !px-2 text-[10px]" onClick={() => onStatus('Completed')} data-testid={`button-complete-sprint-${sprint.id}`}>Complete</button>}{sprint.status === 'Completed' && <button className="button secondary !py-1.5 !px-2 text-[10px]" onClick={() => onStatus('Planned')} data-testid={`button-reopen-sprint-${sprint.id}`}>Reopen</button>}</div></div>;
}

function ActivityLine({ item }: { item: Activity }) {
  return <div className="activity-row"><div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e2ebe5] text-[9px] font-bold text-[#397461]">{initials(item.actorName)}</div><div><div className="text-[#51575a]"><b>{item.actorName}</b> {item.action} <b>{item.target}</b></div><div className="mt-1 text-[10px] text-[#999b93]">{relativeTime(item.createdAt)}</div></div></div>;
}

function Modal({ title, subtitle, close, children }: { title: string; subtitle: string; close: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className="modal fade-up" role="dialog" aria-modal="true" aria-label={title} data-testid="dialog-modal"><div className="modal-head"><div><h2 className="display text-[22px] font-extrabold tracking-[-.045em]">{title}</h2><p className="mt-1 text-xs text-[#858981]">{subtitle}</p></div><button onClick={close} className="icon-button" aria-label="Close dialog" data-testid="button-close-modal"><X size={18} /></button></div>{children}</section></div>;
}

function AuthIssue() {
  return <div className="min-h-[100dvh] grid place-items-center p-5"><div className="panel max-w-md p-7 text-center"><div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-[#f6e5dc] text-[#a85b43]"><CircleHelp size={19} /></div><h1 className="display text-xl font-extrabold">Can’t confirm your session</h1><p className="mt-2 text-xs leading-5 text-[#858982]">The account service isn’t responding right now. Try again in a moment.</p><button className="button mt-5" onClick={() => window.location.reload()} data-testid="button-auth-retry">Retry</button></div></div>;
}

function NotFoundPage() {
  return <div className="min-h-[100dvh] grid place-items-center p-5"><div className="panel max-w-md p-8 text-center"><div className="eyebrow">404 / Not on this board</div><h1 className="display mt-2 text-3xl font-extrabold tracking-[-.05em]">This page moved.</h1><p className="mt-2 text-xs text-[#878b84]">That route doesn’t lead to a SyncFlow view.</p><Link href="/dashboard" className="button mt-5" data-testid="link-not-found-home">Go to your workspace<ArrowRight size={14} /></Link></div></div>;
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Something went wrong. Please try again.';
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase(); }
function formatDate(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) return value; return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function relativeTime(value: string) { const diff = Date.now() - new Date(value).getTime(); if (!Number.isFinite(diff)) return 'recently'; const m = Math.max(0, Math.floor(diff / 60000)); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; const d = Math.floor(h / 24); return `${d}d ago`; }

export default App;
