import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Bot, Send, Loader2, Sparkles, MessageSquare, Trash2, ImagePlus, X, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  images?: string[];
}

const SUGGESTIONS = [
  "¿Qué tengo hoy?",
  "Cuéntame qué sabes de mí",
  "Analiza mi portafolio",
  "¿Qué jueves tengo libre?",
  "¿Cómo va mi cartera?",
  "Resumen de la semana",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const clearChat = () => {
    setMessages([]);
    setSelectedImages([]);
  };

  const compressImage = (file: File, maxWidth = 1200, quality = 0.7): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }
          
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedDataUrl);
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter((file) => {
      if (file.size > 20 * 1024 * 1024) {
        alert(`La imagen ${file.name} es muy grande. Máximo 20MB.`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const newImages: string[] = [];
    
    for (const file of validFiles) {
      try {
        const compressed = await compressImage(file);
        newImages.push(compressed);
      } catch (err) {
        console.error('Error compressing image:', err);
      }
    }
    
    if (newImages.length > 0) {
      setSelectedImages(prev => [...prev, ...newImages]);
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const sendMessage = async (messageText?: string) => {
    const userMessage = (messageText || input).trim();
    if ((!userMessage && selectedImages.length === 0) || isLoading) return;

    const historyBeforeSend = [...messages];
    const currentImages = [...selectedImages];
    setInput("");
    setSelectedImages([]);
    
    const imageCountText = currentImages.length > 1 
      ? `📷 ${currentImages.length} imágenes adjuntas` 
      : currentImages.length === 1 ? "📷 Imagen adjunta" : "";
    
    setMessages((prev) => [...prev, { 
      role: "user", 
      content: userMessage || imageCountText || "📷 Analiza estas imágenes", 
      timestamp: new Date(),
      images: currentImages.length > 0 ? currentImages : undefined
    }]);
    setIsLoading(true);

    try {
      const defaultMessage = currentImages.length > 1 
        ? `Analiza estas ${currentImages.length} imágenes de mi broker/cartera y extrae la información de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agrégalas a mi portafolio.`
        : "Analiza esta imagen de mi broker/cartera y extrae la información de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agrégalas a mi portafolio.";
      
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage || defaultMessage,
          conversationHistory: historyBeforeSend.map(m => ({ role: m.role, content: m.content })),
          images: currentImages.length > 0 ? currentImages : undefined,
        }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let assistantMessage = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "", timestamp: new Date() }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                assistantMessage += data.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    content: assistantMessage,
                    timestamp: new Date(),
                  };
                  return updated;
                });
              }
              if (data.taskCreated || data.radioUpdated || data.googleEventCreated || data.investmentCreated || data.investmentUpdated) {
                queryClient.invalidateQueries({ queryKey: ["tasks"] });
                queryClient.invalidateQueries({ queryKey: ["investments"] });
              }
            } catch (e) {}
          }
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error al procesar tu mensaje. Intenta de nuevo.", timestamp: new Date() },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  };

  const formatContent = (content: string) => {
    return content
      .replace(/\[CREAR_TAREA:.*?\]/g, "✅ Tarea creada")
      .replace(/\[MODIFICAR_RADIO:.*?\]/g, "✅ Radio actualizado")
      .replace(/\[CREAR_EVENTO_GOOGLE:.*?\]/g, "✅ Evento creado en Google Calendar")
      .replace(/\[AGREGAR_INVERSION:.*?\]/g, "✅ Inversión agregada")
      .replace(/\[ACTUALIZAR_INVERSION:.*?\]/g, "✅ Inversión actualizada")
      .replace(/\[ELIMINAR_INVERSION:.*?\]/g, "✅ Inversión eliminada")
      .replace(/\[GUARDAR_INFO:.*?\]/g, "");
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-emerald-950/30 border-b border-zinc-800/50 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-emerald-400 rounded-full border-2 border-zinc-900" />
              </div>
              <div>
                <h1 className="font-semibold text-white text-lg">BlackOps Assistant</h1>
                <p className="text-xs text-emerald-400/80">Powered by Gemini</p>
              </div>
            </div>
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChat}
              className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              data-testid="button-clear-chat"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Limpiar
            </Button>
          )}
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="max-w-4xl mx-auto p-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16">
              <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center mb-6 shadow-inner">
                <MessageSquare className="h-10 w-10 text-zinc-600" />
              </div>
              <h2 className="text-2xl font-medium text-zinc-300 mb-3">¿En qué puedo ayudarte?</h2>
              <p className="text-zinc-500 max-w-md mb-8">
                Pregunta sobre tu calendario, analiza tu portafolio, sube capturas de tu broker, o crea tareas con lenguaje natural.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full max-w-lg">
                {SUGGESTIONS.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(suggestion)}
                    className="text-left text-sm px-4 py-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-emerald-500/50 text-zinc-400 hover:text-zinc-200 transition-all"
                    data-testid={`suggestion-${i}`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={cn(
                    "flex gap-4",
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div className={cn(
                    "flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center",
                    msg.role === "user" 
                      ? "bg-gradient-to-br from-blue-500 to-blue-700" 
                      : "bg-gradient-to-br from-emerald-500 to-emerald-700"
                  )}>
                    {msg.role === "user" ? (
                      <span className="text-sm font-bold text-white">TÚ</span>
                    ) : (
                      <Bot className="h-5 w-5 text-white" />
                    )}
                  </div>
                  <div className={cn(
                    "flex flex-col max-w-[75%]",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}>
                    <div
                      className={cn(
                        "rounded-2xl px-5 py-3 text-sm shadow-sm",
                        msg.role === "user"
                          ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-br-md"
                          : "bg-zinc-800/80 text-zinc-100 border border-zinc-700/50 rounded-bl-md"
                      )}
                      data-testid={`message-${msg.role}-${i}`}
                    >
                      {msg.images && msg.images.length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {msg.images.map((img, imgIdx) => (
                            <img 
                              key={imgIdx}
                              src={img} 
                              alt={`Imagen adjunta ${imgIdx + 1}`} 
                              className="max-w-[120px] max-h-32 rounded-lg border border-white/20 object-cover"
                              data-testid={`image-${msg.role}-${i}-${imgIdx}`}
                            />
                          ))}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap leading-relaxed">{formatContent(msg.content)}</p>
                    </div>
                    <span className="text-xs text-zinc-600 mt-1.5 px-1">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                </motion.div>
              ))}
              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-4"
                >
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-zinc-800/80 border border-zinc-700/50 px-5 py-4">
                    <div className="flex gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-zinc-800/50 bg-zinc-900/80 backdrop-blur-sm p-4">
        <div className="max-w-4xl mx-auto">
          {selectedImages.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {selectedImages.map((img, idx) => (
                <div key={idx} className="relative inline-block">
                  <img 
                    src={img} 
                    alt={`Preview ${idx + 1}`} 
                    className="h-20 w-20 object-cover rounded-lg border border-zinc-700"
                    data-testid={`image-preview-${idx}`}
                  />
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute -top-2 -right-2 h-5 w-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white shadow-lg"
                    data-testid={`button-remove-image-${idx}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <span className="text-xs text-zinc-500 self-end mb-1">{selectedImages.length} {selectedImages.length === 1 ? 'imagen' : 'imágenes'}</span>
            </div>
          )}
          <div className="flex gap-3 items-end">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageSelect}
              accept="image/*"
              multiple
              className="hidden"
              data-testid="input-image-file"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="h-12 w-12 rounded-xl bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-700/50 hover:border-emerald-500/50 transition-all flex-shrink-0"
              title="Subir imagen de broker/cartera"
              data-testid="button-upload-image"
            >
              <ImagePlus className="h-5 w-5 text-zinc-400" />
            </Button>
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedImages.length > 0 ? "Describe qué quieres analizar..." : "Escribe tu mensaje..."}
                rows={1}
                className="w-full resize-none bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-3.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
                disabled={isLoading}
                data-testid="input-assistant-message"
                style={{ maxHeight: "120px" }}
              />
            </div>
            <Button
              onClick={() => sendMessage()}
              disabled={(!input.trim() && selectedImages.length === 0) || isLoading}
              size="icon"
              className="h-12 w-12 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:shadow-none transition-all flex-shrink-0"
              data-testid="button-send-message"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
