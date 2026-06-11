import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar as CalendarIcon, CheckCircle2, LayoutGrid, Settings, Sparkles, TrendingUp, Monitor, Code2, Github, Radio } from "lucide-react";
import { Link } from "wouter";
import { TaskForm } from "@/components/task-form";
import { ScheduleView } from "@/components/schedule-view";
import { MonthView } from "@/components/month-view";
import { TaskEditDialog } from "@/components/task-edit-dialog";
import { TaskDetailDialog } from "@/components/task-detail-dialog";
import { SettingsPanel } from "@/components/settings-panel";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { WeeklyReflectionForm } from "@/components/weekly-reflection-form";
import { WeeklyReflectionHistory } from "@/components/weekly-reflection-history";
import { MonthlyGoalsPanel } from "@/components/monthly-goals-panel";
import { YearlyGoalsPanel } from "@/components/yearly-goals-panel";
import { WeeklyTasksPanel } from "@/components/weekly-tasks-panel";
import { NotificationSettings } from "@/components/notification-settings";
import { AssistantChat } from "@/components/assistant-chat";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, startOfDay, isBefore } from "date-fns";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getTasks, createTask, updateTask, deleteTask, deleteTasksByTitle, syncCalendar } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Task, InsertTask, WeeklySummary } from "@shared/schema";

export default function Dashboard() {
  const [view, setView] = useState<"week" | "month" | "reflections">("week");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [reflectionFormOpen, setReflectionFormOpen] = useState(false);
  const [editingSummary, setEditingSummary] = useState<WeeklySummary | null>(null);
  const [reflectionWeekStart, setReflectionWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const { toast } = useToast();

  // Fetch tasks
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: getTasks,
  });

  // Auto-reschedule overdue tasks - they chase you until completed!
  useEffect(() => {
    if (tasks && tasks.length > 0) {
      const today = startOfDay(new Date());
      
      // Find overdue NON-recurring tasks (not completed, date before today, type is 'task')
      // Recurring/weekly tasks are NOT auto-rescheduled — they stay on their original date
      const overdueTasks = tasks.filter(task => {
        const taskDate = startOfDay(new Date(task.date));
        return (
          !task.completed &&
          !task.isRecurring &&
          isBefore(taskDate, today) &&
          task.type === 'task'
        );
      });

      if (overdueTasks.length === 0) return;

      // Reschedule each overdue task to today, preserving original date for tracking
      const promises = overdueTasks.map(task => {
        const originalTime = new Date(task.date);
        const newDate = new Date();
        newDate.setHours(originalTime.getHours(), originalTime.getMinutes(), 0, 0);
        
        return updateTask(task.id, { 
          date: newDate, 
          // Keep the first originalDate (when it was originally scheduled)
          originalDate: task.originalDate || task.date
        });
      });

      Promise.all(promises)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          toast({
            title: "Tareas pendientes",
            description: `${overdueTasks.length} tarea(s) te persiguen hasta que las completes.`,
          });
        })
        .catch(console.error);
    }
  }, [tasks]);

  // Auto-sync Google Calendar on first load
  useEffect(() => {
    const autoSync = async () => {
      try {
        const result = await syncCalendar();
        if (result.synced > 0) {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          toast({ 
            title: "Calendario sincronizado", 
            description: `Se importaron ${result.synced} eventos de Google Calendar.` 
          });
        }
      } catch (error) {
        // Silently ignore if calendar is not connected
        console.log("Calendar sync skipped:", error);
      }
    };
    autoSync();
  }, []);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Tarea creada", description: "Se agregó a tu calendario." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo crear la tarea.", variant: "destructive" });
    },
  });

  // Update mutation with optimistic updates
  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<InsertTask> }) =>
      updateTask(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previousTasks = queryClient.getQueryData<Task[]>(["tasks"]);
      
      queryClient.setQueryData<Task[]>(["tasks"], (old) => {
        if (!old) return old;
        return old.map((task) =>
          task.id === id ? { ...task, ...updates } : task
        );
      });
      
      return { previousTasks };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Tarea actualizada", description: "Los cambios se guardaron." });
    },
    onError: (err, variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(["tasks"], context.previousTasks);
      }
      toast({ title: "Error", description: "No se pudo actualizar. Intenta de nuevo.", variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Tarea eliminada", description: "Se removió del calendario." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar.", variant: "destructive" });
    },
  });

  const handleAddTask = (newTask: any) => {
    createMutation.mutate(newTask);
  };

  const handleToggleTask = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (task) {
      updateMutation.mutate({
        id,
        updates: { completed: !task.completed },
      });
    }
  };

  const handleViewTask = (task: any) => {
    setSelectedTask(task);
    setDetailDialogOpen(true);
  };

  const handleEditTask = (task: any) => {
    setEditingTask(task);
    setEditDialogOpen(true);
  };

  const handleSaveTask = (updatedTask: any) => {
    updateMutation.mutate({
      id: updatedTask.id,
      updates: {
        title: updatedTask.title,
        date: updatedTask.date,
        priority: updatedTask.priority,
        isRecurring: updatedTask.isRecurring ?? false,
      },
    });
    setEditDialogOpen(false);
  };

  const handleDeleteTask = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    
    // Check if there are other tasks with the same title (recurring events)
    const sameTitle = tasks.filter(t => t.title === task.title);
    
    if (sameTitle.length > 1) {
      // Show confirmation dialog
      setTaskToDelete(task);
      setDeleteDialogOpen(true);
    } else {
      // Just delete the single task
      deleteMutation.mutate(id);
    }
  };

  const handleMoveTask = (taskId: string, newDate: Date) => {
    updateMutation.mutate({
      id: taskId,
      updates: { date: newDate },
    });
  };

  const handleDeleteOne = () => {
    if (taskToDelete) {
      deleteMutation.mutate(taskToDelete.id);
      setDeleteDialogOpen(false);
      setTaskToDelete(null);
    }
  };

  const handleDeleteAll = async () => {
    if (taskToDelete) {
      try {
        const result = await deleteTasksByTitle(taskToDelete.title);
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        toast({ 
          title: "Eventos eliminados", 
          description: `Se eliminaron ${result.deleted} eventos.` 
        });
      } catch (error) {
        toast({ 
          title: "Error", 
          description: "No se pudieron eliminar los eventos.", 
          variant: "destructive" 
        });
      }
      setDeleteDialogOpen(false);
      setTaskToDelete(null);
    }
  };

  const todayTasks = tasks.filter(t => 
    new Date(t.date).toDateString() === new Date().toDateString()
  );
  
  const progress = todayTasks.length > 0
    ? Math.round((todayTasks.filter(t => t.completed).length / todayTasks.length) * 100)
    : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-zinc-400">Cargando tareas...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Sidebar Navigation */}
      <nav className="w-full md:w-20 border-b md:border-b-0 md:border-r border-zinc-800 bg-zinc-950 flex md:flex-col items-center justify-between md:justify-start px-2 py-1.5 md:p-4 md:py-8 gap-1 md:gap-8 z-10">
        <div className="w-7 h-7 md:w-10 md:h-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-950 font-bold text-sm md:text-xl flex-shrink-0">
          B
        </div>
        
        <div className="flex md:flex-col gap-0.5 md:gap-1 items-center flex-1 justify-center md:justify-start md:overflow-y-auto md:py-2">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setView("week")}
            className={cn(
              "transition-colors h-7 w-7 md:h-10 md:w-10",
              view === "week" 
                ? "text-white bg-zinc-800" 
                : "text-zinc-400 hover:text-white hover:bg-zinc-900"
            )}
          >
            <LayoutGrid className="w-4 h-4 md:w-6 md:h-6" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setView("month")}
            className={cn(
              "transition-colors h-7 w-7 md:h-10 md:w-10",
              view === "month" 
                ? "text-white bg-zinc-800" 
                : "text-zinc-400 hover:text-white hover:bg-zinc-900"
            )}
          >
            <CalendarIcon className="w-4 h-4 md:w-6 md:h-6" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setView("reflections")}
            className={cn(
              "transition-colors h-7 w-7 md:h-10 md:w-10",
              view === "reflections" 
                ? "text-purple-400 bg-purple-900/30" 
                : "text-zinc-400 hover:text-purple-400 hover:bg-purple-900/20"
            )}
            data-testid="button-reflections"
          >
            <Sparkles className="w-4 h-4 md:w-6 md:h-6" />
          </Button>
          <NotificationSettings />
          <Link href="/projects">
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-400 hover:text-cyan-400 hover:bg-cyan-900/20 h-7 w-7 md:h-10 md:w-10"
              data-testid="button-projects"
            >
              <Monitor className="w-4 h-4 md:w-6 md:h-6" />
            </Button>
          </Link>
          <Link href="/portfolio">
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-900/20 h-7 w-7 md:h-10 md:w-10"
              data-testid="button-portfolio"
            >
              <TrendingUp className="w-4 h-4 md:w-6 md:h-6" />
            </Button>
          </Link>
          <Link href="/code-agent">
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-400 hover:text-violet-400 hover:bg-violet-900/20 h-7 w-7 md:h-10 md:w-10"
              data-testid="button-code-agent"
            >
              <Code2 className="w-4 h-4 md:w-6 md:h-6" />
            </Button>
          </Link>
          <Link href="/github-agent">
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-400 hover:text-white hover:bg-zinc-800 h-7 w-7 md:h-10 md:w-10"
              data-testid="button-github-agent"
            >
              <Github className="w-4 h-4 md:w-6 md:h-6" />
            </Button>
          </Link>
          <Link href="/radio">
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-400 hover:text-red-400 hover:bg-red-900/20 h-7 w-7 md:h-10 md:w-10"
              data-testid="button-radio"
            >
              <Radio className="w-4 h-4 md:w-6 md:h-6" />
            </Button>
          </Link>
          <AssistantChat />
        </div>

        <div className="hidden md:flex mt-auto">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setSettingsOpen(true)}
            className="text-zinc-400 hover:text-white hover:bg-zinc-900"
            data-testid="button-settings"
          >
            <Settings className="w-6 h-6" />
          </Button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-12 overflow-y-auto">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-4">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter text-white mb-2">
              Good Morning.
            </h1>
            <p className="text-zinc-400 font-mono">
              {format(new Date(), "EEEE, MMMM do, yyyy")}
            </p>
          </div>
          
          <div className="flex gap-4 items-center">
             <div className="text-right">
                <div className="text-sm text-zinc-500 mb-1">Progreso Hoy</div>
                <div className="text-2xl font-mono text-white">{progress}%</div>
             </div>
             <div className="w-16 h-16 rounded-full border-4 border-zinc-800 flex items-center justify-center relative">
                <div 
                  className="absolute inset-0 rounded-full border-4 border-white transition-all duration-1000"
                  style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }} 
                />
                <CheckCircle2 className="w-6 h-6 text-zinc-600 relative z-10" />
             </div>
          </div>
        </header>

        <div className="space-y-8">
          {/* View based on button selection */}
          {view === "week" ? (
              <div className="space-y-8">
                {/* Top: Task Input (Natural Language) */}
                <TaskForm onAddTask={handleAddTask} />

                {/* Weekly Schedule Overview */}
                <ScheduleView 
                  tasks={tasks} 
                  onToggleTask={handleToggleTask}
                  onEditTask={handleEditTask}
                  onDeleteTask={handleDeleteTask}
                  onViewTask={handleViewTask}
                  onMoveTask={handleMoveTask}
                />

                {/* Bottom: Panels Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Esta Semana */}
                  <div>
                    <WeeklyTasksPanel />
                  </div>

                  {/* Metas Mensuales */}
                  <div>
                    <MonthlyGoalsPanel />
                  </div>

                  {/* Metas 2026 */}
                  <div>
                    <YearlyGoalsPanel year="2026" />
                  </div>
                </div>
              </div>
          ) : view === "month" ? (
            <MonthView 
              tasks={tasks} 
              onTaskClick={handleToggleTask}
              onEditTask={handleEditTask}
              onDeleteTask={handleDeleteTask}
              onViewTask={handleViewTask}
            />
          ) : (
            <WeeklyReflectionHistory
              onSelectWeek={(summary) => {
                setEditingSummary(summary);
                setReflectionWeekStart(new Date(summary.weekStart));
                setReflectionFormOpen(true);
              }}
              onNewReflection={() => {
                setEditingSummary(null);
                setReflectionWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
                setReflectionFormOpen(true);
              }}
            />
          )}
        </div>
      </main>

      {/* Edit Dialog */}
      <TaskEditDialog
        task={editingTask}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSave={handleSaveTask}
      />

      <TaskDetailDialog
        task={selectedTask}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        onEdit={handleEditTask}
        onDelete={(id) => {
          const task = tasks.find(t => t.id === id);
          if (task) {
            setTaskToDelete(task);
            setDeleteDialogOpen(true);
          }
        }}
        onToggle={handleToggleTask}
      />

      {/* Settings Panel */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setTaskToDelete(null);
        }}
        onDeleteOne={handleDeleteOne}
        onDeleteAll={handleDeleteAll}
        taskTitle={taskToDelete?.title || ""}
        seriesCount={taskToDelete ? tasks.filter(t => t.title === taskToDelete.title).length : 0}
      />

      {/* Weekly Reflection Form Modal */}
      <AnimatePresence>
        {reflectionFormOpen && (
          <WeeklyReflectionForm
            weekStart={reflectionWeekStart}
            existingSummary={editingSummary || undefined}
            onClose={() => {
              setReflectionFormOpen(false);
              setEditingSummary(null);
            }}
            onSaved={() => {
              toast({ 
                title: "Reflexión guardada", 
                description: "Tu resumen semanal se guardó correctamente." 
              });
            }}
          />
        )}
      </AnimatePresence>

      <Toaster />
    </div>
  );
}
