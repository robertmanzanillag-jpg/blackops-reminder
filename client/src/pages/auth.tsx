import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Fingerprint, LockKeyhole, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";

type AuthMode = "login" | "register";

const LOCAL_USERS_KEY = "blackops-local-auth-users";
const LOCAL_AUTH_USER_KEY = "blackops-local-auth-user";
const LOCAL_PASSKEY_KEY = "blackops-local-passkey";
const PREVIEW_USER = { id: "mock-user-123", username: "robert" };

type LocalUser = { id: string; username: string; passwordHash: string };
type LocalPasskey = { credentialId: string; user: { id: string; username: string } };

function isLocalPreview() {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

function toBase64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomBytes(length = 32) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

async function hashPassword(password: string) {
  const encoded = new TextEncoder().encode(password);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return toBase64Url(digest);
}

function getLocalUsers(): Record<string, LocalUser> {
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_USERS_KEY) || "{}") as Record<string, LocalUser>;
  } catch {
    return {};
  }
}

function setCurrentLocalUser(user: { id: string; username: string }) {
  window.localStorage.setItem(LOCAL_AUTH_USER_KEY, JSON.stringify(user));
}

function loginAsPreviewUser() {
  setCurrentLocalUser(PREVIEW_USER);
  return { authenticated: true, user: PREVIEW_USER };
}

async function localSubmitAuth(mode: AuthMode, username: string, password: string) {
  if (!isLocalPreview()) throw new Error("El servidor de login no esta disponible");

  const cleanUsername = username.trim().toLowerCase();
  const users = getLocalUsers();
  const passwordHash = await hashPassword(password);

  if (mode === "register") {
    if (users[cleanUsername]) throw new Error("Ese usuario ya existe en este navegador");
    const user = { id: crypto.randomUUID(), username: cleanUsername, passwordHash };
    users[cleanUsername] = user;
    window.localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
    setCurrentLocalUser({ id: user.id, username: user.username });
    return { authenticated: true, user: { id: user.id, username: user.username } };
  }

  const user = users[cleanUsername];
  if (!user || user.passwordHash !== passwordHash) {
    throw new Error("Usuario o password incorrecto en este navegador");
  }
  setCurrentLocalUser({ id: user.id, username: user.username });
  return { authenticated: true, user: { id: user.id, username: user.username } };
}

async function submitAuth(mode: AuthMode, username: string, password: string) {
  try {
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return await localSubmitAuth(mode, username, password);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "No se pudo iniciar sesion");
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && !isLocalPreview()) throw error;
    return await localSubmitAuth(mode, username, password);
  }
}

async function enablePasskey(username: string, password: string) {
  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername) throw new Error("Escribe tu usuario primero");
  if (password.length < 8) throw new Error("Escribe un password de minimo 8 caracteres");
  if (!window.PublicKeyCredential) throw new Error("Este navegador no soporta huella, Face ID o passkeys");

  const users = getLocalUsers();
  let user = users[cleanUsername];
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      passwordHash: await hashPassword(password),
    };
    users[cleanUsername] = user;
    window.localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  }

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(),
      rp: { name: "BlackOps CEO" },
      user: {
        id: new TextEncoder().encode(user.id),
        name: user.username,
        displayName: user.username,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60000,
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error("No se pudo activar huella / Face ID");
  const rawId = credential.rawId;
  window.localStorage.setItem(LOCAL_PASSKEY_KEY, JSON.stringify({
    credentialId: toBase64Url(rawId),
    user: { id: user.id, username: user.username },
  } satisfies LocalPasskey));
  setCurrentLocalUser({ id: user.id, username: user.username });
}

async function loginWithPasskey() {
  if (!window.PublicKeyCredential) throw new Error("Este navegador no soporta huella, Face ID o passkeys");
  const stored = window.localStorage.getItem(LOCAL_PASSKEY_KEY);
  if (!stored) throw new Error("Activa huella / Face ID primero en este dispositivo");

  const passkey = JSON.parse(stored) as LocalPasskey;
  const credentialId = fromBase64Url(passkey.credentialId);
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(),
      allowCredentials: [{ id: credentialId, type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });

  if (!credential) throw new Error("Huella / Face ID cancelado");
  setCurrentLocalUser(passkey.user);
  return { authenticated: true, user: passkey.user };
}

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passkeyMessage, setPasskeyMessage] = useState("");
  const passkeySupported = typeof window !== "undefined" && Boolean(window.PublicKeyCredential);
  const passkeyConfigured = typeof window !== "undefined" && Boolean(window.localStorage.getItem(LOCAL_PASSKEY_KEY));

  const authMutation = useMutation({
    mutationFn: () => submitAuth(mode, username, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
  });
  const passkeyLoginMutation = useMutation({
    mutationFn: loginWithPasskey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
  });
  const passkeySetupMutation = useMutation({
    mutationFn: () => enablePasskey(username, password),
    onSuccess: () => {
      setPasskeyMessage("Huella / Face ID quedo activado en este dispositivo.");
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
  });
  const previewLoginMutation = useMutation({
    mutationFn: async () => loginAsPreviewUser(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
  });

  const canSubmit = username.trim().length >= 2 && password.length >= 8 && !authMutation.isPending;

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
        <Card className="w-full border-white/10 bg-zinc-950/90">
          <CardHeader className="space-y-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
              <LockKeyhole className="h-5 w-5 text-emerald-300" />
            </div>
            <CardTitle className="text-2xl text-white">BlackOps CEO</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-5 grid grid-cols-2 rounded-lg border border-white/10 bg-black p-1">
              <Button
                type="button"
                variant={mode === "login" ? "default" : "ghost"}
                className="gap-2"
                onClick={() => setMode("login")}
              >
                <LogIn className="h-4 w-4" />
                Entrar
              </Button>
              <Button
                type="button"
                variant={mode === "register" ? "default" : "ghost"}
                className="gap-2"
                onClick={() => setMode("register")}
              >
                <UserPlus className="h-4 w-4" />
                Crear
              </Button>
            </div>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmit) authMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="username" className="text-zinc-300">Usuario</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  className="border-white/10 bg-black"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-zinc-300">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="border-white/10 bg-black"
                />
              </div>

              {authMutation.isError && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {(authMutation.error as Error).message}
                </p>
              )}

              <Button type="submit" disabled={!canSubmit} className="w-full gap-2">
                {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {mode === "login" ? "Entrar" : "Crear cuenta"}
              </Button>
            </form>

            {isLocalPreview() && (
              <Button
                type="button"
                variant="secondary"
                disabled={previewLoginMutation.isPending}
                className="mt-4 w-full gap-2"
                onClick={() => previewLoginMutation.mutate()}
              >
                <LogIn className="h-4 w-4" />
                Entrar como Robert
              </Button>
            )}

            <div className="mt-4 space-y-2">
              <Button
                type="button"
                variant="outline"
                disabled={!passkeySupported || !passkeyConfigured || passkeyLoginMutation.isPending}
                className="w-full gap-2 border-white/10 bg-black text-white hover:bg-white/10"
                onClick={() => passkeyLoginMutation.mutate()}
              >
                <Fingerprint className="h-4 w-4" />
                Entrar con huella / Face ID
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!passkeySupported || username.trim().length < 2 || password.length < 8 || passkeySetupMutation.isPending}
                className="w-full gap-2 text-zinc-300 hover:bg-white/10 hover:text-white"
                onClick={() => passkeySetupMutation.mutate()}
              >
                <Fingerprint className="h-4 w-4" />
                Activar huella / Face ID en este dispositivo
              </Button>
              {(passkeyMessage || passkeyLoginMutation.isError || passkeySetupMutation.isError) && (
                <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300">
                  {passkeyMessage ||
                    (passkeyLoginMutation.error as Error | undefined)?.message ||
                    (passkeySetupMutation.error as Error | undefined)?.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
