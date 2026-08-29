import { type AnimationEvent as ReactAnimationEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowBigUpDash, ArrowRight, Shield } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import type { BootstrapData } from "@/types";
import { Logo, ServerCard } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const passwordFieldErrorClass = "password-field-error border-red-500 bg-red-50 text-red-900 ring-2 ring-red-500/20 focus-visible:border-red-500 focus-visible:ring-red-500/20";
type AuthMode = "login" | "register";
const directionForMode = (mode: AuthMode) => mode === "register" ? "from-right" : "from-left";

interface AuthScreenProps {
  data: BootstrapData;
  mode: AuthMode;
  onAuth: (action: "login" | "register" | "reset", username: string, password: string, serverPassword: string) => Promise<void>;
  onModeChange: (mode: AuthMode) => void;
  onOpenAdmin: () => void;
  notice: (message: string) => void;
}

function AuthModeContainer({ mode, renderContent }: { mode: AuthMode; renderContent: (mode: AuthMode) => ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [displayMode, setDisplayMode] = useState(mode);
  const [transition, setTransition] = useState<{ from: AuthMode; to: AuthMode } | null>(null);
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    if (mode === displayMode || transition) return;
    setTransition({ from: displayMode, to: mode });
  }, [displayMode, mode, transition]);

  useEffect(() => {
    if (!transition || !window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setDisplayMode(transition.to);
    setTransition(null);
  }, [transition]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const updateHeight = () => setHeight(content.offsetHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const finishAnimation = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !transition) return;
    setDisplayMode(transition.to);
    setTransition(null);
  };

  const direction = directionForMode(transition?.to ?? displayMode);

  return (
    <div className="auth-mode-slot">
      <div className="t-resize auth-mode-container" style={height === undefined ? undefined : { height }}>
        <div className="auth-mode-stage" ref={contentRef}>
          {transition ? <>
            <div className="auth-mode-panel" data-direction={direction} data-layer="outgoing" data-state="exiting" inert aria-hidden="true">
              {renderContent(transition.from)}
            </div>
            <div className="auth-mode-panel" data-direction={direction} data-layer="incoming" data-state="entering" inert aria-hidden="true" onAnimationEnd={finishAnimation}>
              {renderContent(transition.to)}
            </div>
          </> : (
            <div className="auth-mode-panel" data-direction={direction} data-state="idle">
              {renderContent(displayMode)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuthScreen({ data, mode, onAuth, onModeChange, onOpenAdmin, notice }: AuthScreenProps) {
  const [username, setUsername] = useState("");
  const [availability, setAvailability] = useState<{ available: boolean; exists: boolean; resetRequired: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [serverPasswordError, setServerPasswordError] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  useEffect(() => {
    setAvailability(null);
    if (!/^[\p{L}\p{N}_]{1,16}$/u.test(username.normalize("NFC").trim())) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<{ available: boolean; exists: boolean; resetRequired: boolean }>(`/auth/username-availability?username=${encodeURIComponent(username)}`, { signal: controller.signal })
        .then(setAvailability)
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setAvailability(null);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [username]);

  const submit = async (event: FormEvent, activeMode: AuthMode) => {
    event.preventDefault();
    const resetRequired = activeMode === "login" && availability?.resetRequired === true;
    setPasswordError(false);
    setServerPasswordError(false);
    setBusy(true);
    try {
      await onAuth(resetRequired ? "reset" : activeMode, username, password, serverPassword);
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_LOGIN") {
        if (resetRequired) setServerPasswordError(true);
        else setPasswordError(true);
      }
      else if (error instanceof ApiError && (error.code === "INVALID_SERVER_PASSWORD" || error.code === "INVALID_RESET_CODE")) setServerPasswordError(true);
      else notice(error instanceof Error ? error.message : "인증에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  const renderAuthForm = (activeMode: AuthMode) => {
    const resetRequired = activeMode === "login" && availability?.resetRequired === true;
    const authLabel = resetRequired ? "비밀번호 변경" : activeMode === "register" ? "가입" : "로그인";
    const suggestedMode = activeMode === "login" && availability?.available
      ? "register"
      : activeMode === "register" && availability?.exists
        ? "login"
        : null;

    return (
      <Card className="overflow-visible border-0 bg-transparent p-0 shadow-none ring-0">
        <CardContent className="px-0">
          <form onSubmit={(event) => void submit(event, activeMode)}>
          <FieldGroup>
            <div className="flex flex-col gap-2">
              <Field>
                <FieldLabel className="sr-only" htmlFor="username">플레이어 이름</FieldLabel>
                <Input className="h-11 rounded-full px-4 shadow-none" id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={activeMode === "register" ? "플레이어 이름 (한글 지원)" : "플레이어 이름"} minLength={1} maxLength={16} required />
              </Field>
              <Field>
                <FieldLabel className="sr-only" htmlFor="password">{resetRequired ? "새 비밀번호" : "비밀번호"}</FieldLabel>
                <div className="relative">
                  <Input
                    className={cn("h-11 rounded-full px-4 pr-12 shadow-none transition-colors", passwordError && passwordFieldErrorClass)}
                    id="password"
                    type="password"
                    autoComplete={resetRequired ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); setPasswordError(false); }}
                    onKeyDown={(event) => setCapsLockOn(event.getModifierState("CapsLock"))}
                    onKeyUp={(event) => setCapsLockOn(event.getModifierState("CapsLock"))}
                    onBlur={() => setCapsLockOn(false)}
                    onAnimationEnd={() => setPasswordError(false)}
                    aria-invalid={passwordError}
                    placeholder={resetRequired ? "새 비밀번호 (8자 이상)" : activeMode === "register" ? "비밀번호 (8자 이상)" : "비밀번호"}
                    minLength={activeMode === "register" || resetRequired ? 8 : undefined}
                    maxLength={128}
                    required
                  />
                  {capsLockOn && (
                    <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-muted-foreground" role="status">
                      <ArrowBigUpDash className="size-4" aria-hidden="true" />
                      <span className="sr-only">Caps Lock 켜짐</span>
                    </span>
                  )}
                </div>
                {resetRequired && <FieldDescription className="px-2">관리자가 초기화했어요. 새 비밀번호와 전달받은 6자리 코드를 입력하면 바로 로그인합니다.</FieldDescription>}
              </Field>
              {(activeMode === "register" || resetRequired) && <Field>
                <FieldLabel className="sr-only" htmlFor="server-password">{resetRequired ? "초기화 코드" : "가입 질문 답"}</FieldLabel>
                <Input
                  className={cn("h-11 rounded-full px-4 shadow-none transition-colors", serverPasswordError && passwordFieldErrorClass)}
                  id="server-password"
                  type={resetRequired ? "password" : "text"}
                  autoComplete={resetRequired ? "one-time-code" : "off"}
                  inputMode={resetRequired ? "numeric" : undefined}
                  value={serverPassword}
                  onChange={(event) => { setServerPassword(event.target.value); setServerPasswordError(false); }}
                  onAnimationEnd={() => setServerPasswordError(false)}
                  aria-invalid={serverPasswordError}
                  placeholder={resetRequired ? "초기화 코드 6자리" : "도덕 시간에 쓰는 건?"}
                  pattern={resetRequired ? "[0-9]{6}" : undefined}
                  maxLength={resetRequired ? 6 : 128}
                  required
                />
              </Field>}
            </div>
            <Button size="lg" className="h-11 w-full rounded-full px-4" disabled={busy}>
              {busy ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
              <span aria-live="polite">{authLabel}</span>
            </Button>
            <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground" aria-live="polite">
              <span>{suggestedMode === "register" ? "없는 이름이에요. 대신" : suggestedMode === "login" ? "이미 있는 이름이에요. 대신" : activeMode === "login" ? "계정이 없나요?" : "계정이 있나요?"}</span>
              <Button type="button" variant="link" className="h-auto p-0 font-semibold" disabled={busy} onClick={() => onModeChange(suggestedMode ?? (activeMode === "login" ? "register" : "login"))}>
                {suggestedMode === "register" ? "가입할까요?" : suggestedMode === "login" ? "로그인할까요?" : activeMode === "login" ? "가입" : "로그인"}
              </Button>
            </div>
          </FieldGroup>
          </form>
        </CardContent>
      </Card>
    );
  };

  return (
    <main className="auth-shell">
      <header className="dashboard-header">
        <Logo />
        <Button variant="ghost" size="icon-sm" className="cursor-pointer text-muted-foreground" onClick={onOpenAdmin} aria-label="관리자 패널" title="관리자 패널"><Shield /></Button>
      </header>
      <ServerCard status={data.server} setupReady={data.setup.eulaAccepted} compact />
      <AuthModeContainer mode={mode} renderContent={renderAuthForm} />
    </main>
  );
}
