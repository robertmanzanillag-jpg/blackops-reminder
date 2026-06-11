import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor,
  Plus,
  Trash2,
  RefreshCw,
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Activity,
  ExternalLink,
  Github,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import type { MonitoredProject, HealthCheckLog, Incident } from "@shared/schema";

export default function Projects() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [newProject, setNewProject] = useState({
    name: "",
    url: "",
    description: "",
    githubRepo: "",
    notifyOnDown: true,
  });

  const { data: projects = [], isLoading } = useQuery<MonitoredProject[]>({
    queryKey: ["projects"],
    queryFn: () => fetch("/api/projects").then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: logs = [] } = useQuery<HealthCheckLog[]>({
    queryKey: ["project-logs", selectedProject],
    queryFn: () =>
      selectedProject
        ? fetch(`/api/projects/${selectedProject}/logs?limit=50`).then((r) => r.json())
        : [],
    enabled: !!selectedProject,
  });

  const { data: incidents = [] } = useQuery<Incident[]>({
    queryKey: ["project-incidents", selectedProject],
    queryFn: () =>
      selectedProject
        ? fetch(`/api/projects/${selectedProject}/incidents`).then((r) => r.json())
        : [],
    enabled: !!selectedProject,
  });

  const createProject = useMutation({
    mutationFn: (project: typeof newProject) =>
      fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setAddDialogOpen(false);
      setNewProject({ name: "", url: "", description: "", githubRepo: "", notifyOnDown: true });
    },
  });

  const deleteProject = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProject(null);
    },
  });

  const checkProject = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/projects/${id}/check`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (selectedProject) {
        queryClient.invalidateQueries({ queryKey: ["project-logs", selectedProject] });
      }
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "online":
        return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      case "offline":
        return <XCircle className="w-5 h-5 text-red-500" />;
      case "degraded":
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      default:
        return <Clock className="w-5 h-5 text-zinc-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online":
        return "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
      case "offline":
        return "bg-red-500/10 border-red-500/30 text-red-400";
      case "degraded":
        return "bg-yellow-500/10 border-yellow-500/30 text-yellow-400";
      default:
        return "bg-zinc-500/10 border-zinc-500/30 text-zinc-400";
    }
  };

  const onlineCount = projects.filter((p) => p.status === "online").length;
  const offlineCount = projects.filter((p) => p.status === "offline").length;

  const selectedProjectData = projects.find((p) => p.id === selectedProject);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Monitor className="w-6 h-6 text-cyan-500" />
            <h1 className="text-2xl font-bold">Monitoreo de Proyectos</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-cyan-500/10 rounded-lg">
                <Activity className="w-6 h-6 text-cyan-500" />
              </div>
              <div>
                <p className="text-sm text-zinc-400">Total Proyectos</p>
                <p className="text-2xl font-bold" data-testid="text-total-projects">{projects.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-emerald-500/10 rounded-lg">
                <CheckCircle className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm text-zinc-400">En Línea</p>
                <p className="text-2xl font-bold text-emerald-400" data-testid="text-online-count">{onlineCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-red-500/10 rounded-lg">
                <XCircle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-zinc-400">Caídos</p>
                <p className="text-2xl font-bold text-red-400" data-testid="text-offline-count">{offlineCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="projects" className="w-full">
          <div className="flex items-center justify-between mb-4">
            <TabsList className="bg-zinc-900 border border-zinc-800">
              <TabsTrigger value="projects" data-testid="tab-projects">Proyectos</TabsTrigger>
              <TabsTrigger value="details" data-testid="tab-details" disabled={!selectedProject}>
                Detalles
              </TabsTrigger>
            </TabsList>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-cyan-600 hover:bg-cyan-700" data-testid="button-add-project">
                  <Plus className="w-4 h-4 mr-2" />
                  Agregar Proyecto
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-zinc-800">
                <DialogHeader>
                  <DialogTitle>Agregar Proyecto para Monitorear</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Nombre del Proyecto</Label>
                    <Input
                      value={newProject.name}
                      onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                      placeholder="Mi App"
                      className="bg-zinc-800 border-zinc-700"
                      data-testid="input-project-name"
                    />
                  </div>
                  <div>
                    <Label>URL del Proyecto</Label>
                    <Input
                      value={newProject.url}
                      onChange={(e) => setNewProject({ ...newProject, url: e.target.value })}
                      placeholder="https://miapp.replit.app"
                      className="bg-zinc-800 border-zinc-700"
                      data-testid="input-project-url"
                    />
                  </div>
                  <div>
                    <Label>Descripción (opcional)</Label>
                    <Input
                      value={newProject.description}
                      onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                      placeholder="Descripción breve"
                      className="bg-zinc-800 border-zinc-700"
                      data-testid="input-project-description"
                    />
                  </div>
                  <div>
                    <Label>Repositorio GitHub (opcional)</Label>
                    <Input
                      value={newProject.githubRepo}
                      onChange={(e) => setNewProject({ ...newProject, githubRepo: e.target.value })}
                      placeholder="usuario/repositorio"
                      className="bg-zinc-800 border-zinc-700"
                      data-testid="input-github-repo"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Notificar si se cae</Label>
                    <Switch
                      checked={newProject.notifyOnDown}
                      onCheckedChange={(checked) =>
                        setNewProject({ ...newProject, notifyOnDown: checked })
                      }
                      data-testid="switch-notify"
                    />
                  </div>
                  <Button
                    onClick={() => createProject.mutate(newProject)}
                    className="w-full bg-cyan-600 hover:bg-cyan-700"
                    disabled={!newProject.name || !newProject.url}
                    data-testid="button-save-project"
                  >
                    Guardar Proyecto
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <TabsContent value="projects">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin text-cyan-500" />
              </div>
            ) : projects.length === 0 ? (
              <Card className="bg-zinc-900 border-zinc-800">
                <CardContent className="p-12 text-center">
                  <Monitor className="w-12 h-12 mx-auto text-zinc-600 mb-4" />
                  <p className="text-zinc-400 mb-4">No tienes proyectos monitoreados</p>
                  <Button
                    onClick={() => setAddDialogOpen(true)}
                    className="bg-cyan-600 hover:bg-cyan-700"
                    data-testid="button-add-first-project"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Agregar tu primer proyecto
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AnimatePresence>
                  {projects.map((project) => (
                    <motion.div
                      key={project.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                    >
                      <Card
                        className={`bg-zinc-900 border-zinc-800 cursor-pointer transition-colors hover:border-cyan-500/50 ${
                          selectedProject === project.id ? "border-cyan-500" : ""
                        }`}
                        onClick={() => setSelectedProject(project.id)}
                        data-testid={`card-project-${project.id}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              {getStatusIcon(project.status)}
                              <div>
                                <h3 className="font-semibold" data-testid={`text-project-name-${project.id}`}>
                                  {project.name}
                                </h3>
                                <p className="text-sm text-zinc-500 truncate max-w-[200px]">
                                  {project.url}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`px-2 py-1 text-xs rounded-full border ${getStatusColor(
                                project.status
                              )}`}
                              data-testid={`text-status-${project.id}`}
                            >
                              {project.status === "online"
                                ? "En línea"
                                : project.status === "offline"
                                ? "Caído"
                                : project.status === "degraded"
                                ? "Lento"
                                : "Desconocido"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-sm text-zinc-500">
                            <div className="flex items-center gap-4">
                              {project.responseTime && (
                                <span>{project.responseTime}ms</span>
                              )}
                              {project.lastCheck && (
                                <span>
                                  Último check: {new Date(project.lastCheck).toLocaleTimeString("es-ES")}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  checkProject.mutate(project.id);
                                }}
                                disabled={checkProject.isPending}
                                data-testid={`button-check-${project.id}`}
                              >
                                <RefreshCw
                                  className={`w-4 h-4 ${
                                    checkProject.isPending ? "animate-spin" : ""
                                  }`}
                                />
                              </Button>
                              <a
                                href={project.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`link-external-${project.id}`}
                              >
                                <Button variant="ghost" size="icon">
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              </a>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </TabsContent>

          <TabsContent value="details">
            {selectedProjectData && (
              <div className="space-y-6">
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      {getStatusIcon(selectedProjectData.status)}
                      {selectedProjectData.name}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => checkProject.mutate(selectedProjectData.id)}
                        disabled={checkProject.isPending}
                        data-testid="button-check-selected"
                      >
                        <RefreshCw
                          className={`w-4 h-4 mr-2 ${checkProject.isPending ? "animate-spin" : ""}`}
                        />
                        Verificar ahora
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteProject.mutate(selectedProjectData.id)}
                        data-testid="button-delete-selected"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Eliminar
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm text-zinc-400">URL</p>
                        <a
                          href={selectedProjectData.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:underline flex items-center gap-1"
                        >
                          {selectedProjectData.url}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div>
                        <p className="text-sm text-zinc-400">Tiempo de respuesta</p>
                        <p className="font-semibold">
                          {selectedProjectData.responseTime
                            ? `${selectedProjectData.responseTime}ms`
                            : "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-zinc-400">Último check</p>
                        <p className="font-semibold">
                          {selectedProjectData.lastCheck
                            ? new Date(selectedProjectData.lastCheck).toLocaleString("es-ES")
                            : "Nunca"}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-zinc-400">Última vez online</p>
                        <p className="font-semibold">
                          {selectedProjectData.lastOnline
                            ? new Date(selectedProjectData.lastOnline).toLocaleString("es-ES")
                            : "Nunca"}
                        </p>
                      </div>
                    </div>
                    {selectedProjectData.githubRepo && (
                      <div className="mt-4 flex items-center gap-2">
                        <Github className="w-4 h-4 text-zinc-400" />
                        <a
                          href={`https://github.com/${selectedProjectData.githubRepo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:underline"
                        >
                          {selectedProjectData.githubRepo}
                        </a>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="bg-zinc-900 border-zinc-800">
                    <CardHeader>
                      <CardTitle className="text-lg">Historial de Checks</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {logs.length === 0 ? (
                        <p className="text-zinc-500 text-center py-4">Sin historial aún</p>
                      ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                          {logs.slice(0, 20).map((log) => (
                            <div
                              key={log.id}
                              className="flex items-center justify-between p-2 rounded bg-zinc-800/50"
                            >
                              <div className="flex items-center gap-2">
                                {getStatusIcon(log.status)}
                                <span className="text-sm">
                                  {log.status === "online"
                                    ? "En línea"
                                    : log.status === "offline"
                                    ? "Caído"
                                    : "Lento"}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 text-sm text-zinc-500">
                                {log.responseTime && <span>{log.responseTime}ms</span>}
                                <span>
                                  {new Date(log.checkedAt!).toLocaleTimeString("es-ES")}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="bg-zinc-900 border-zinc-800">
                    <CardHeader>
                      <CardTitle className="text-lg">Incidentes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {incidents.length === 0 ? (
                        <p className="text-zinc-500 text-center py-4">Sin incidentes</p>
                      ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                          {incidents.map((incident) => (
                            <div
                              key={incident.id}
                              className="p-3 rounded bg-zinc-800/50 border-l-2 border-red-500"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                  {incident.resolvedAt ? "Resuelto" : "Activo"}
                                </span>
                                <span className="text-xs text-zinc-500">
                                  {new Date(incident.startedAt).toLocaleString("es-ES")}
                                </span>
                              </div>
                              {incident.duration && (
                                <p className="text-sm text-zinc-400 mt-1">
                                  Duración: {Math.floor(incident.duration / 60)}m {incident.duration % 60}s
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
