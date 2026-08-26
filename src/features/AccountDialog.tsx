import { FormEvent, useEffect, useState } from "react";
import { Check, KeyRound, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import type { BootstrapData, PublicUser } from "@/types";

interface AccountDialogProps {
  data: BootstrapData;
  onSession: (user: PublicUser, csrf: string) => void;
  notice: (message: string) => void;
}

export function AccountDialog({ data, onSession, notice }: AccountDialogProps) {
  const user = data.user!;
  const [open, setOpen] = useState(false);
  const [playerName, setPlayerName] = useState(user.displayName);
  const [profileBusy, setProfileBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlayerName(user.displayName);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }, [open, user.displayName, user.username]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileBusy(true);
    try {
      const result = await api<{ user: PublicUser; csrf: string }>("/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-spawnpoint-csrf": data.csrf! },
        body: JSON.stringify({ username: playerName, displayName: playerName }),
      });
      onSession(result.user, result.csrf);
      notice("계정 정보를 변경했어요.");
    } catch (error) {
      notice(error instanceof Error ? error.message : "계정 정보를 변경하지 못했어요");
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      notice("새 비밀번호가 서로 달라요.");
      return;
    }
    setPasswordBusy(true);
    try {
      const result = await api<{ user: PublicUser; csrf: string }>("/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-spawnpoint-csrf": data.csrf! },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onSession(result.user, result.csrf);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notice("비밀번호를 변경했어요. 다른 기기의 로그인은 해제됐어요.");
    } catch (error) {
      notice(error instanceof Error ? error.message : "비밀번호를 변경하지 못했어요");
    } finally {
      setPasswordBusy(false);
    }
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button variant="ghost" size="sm" className="min-w-11 max-w-44 shrink cursor-pointer px-2 text-muted-foreground"><UserRound data-icon="inline-start" /><span className="truncate">{user.displayName}</span></Button>
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto ring-0 sm:max-w-md">
      <DialogHeader>
        <DialogTitle>계정 설정</DialogTitle>
        <DialogDescription className="sr-only">계정 이름 및 비밀번호 변경</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={saveProfile}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="player-name">플레이어 이름</FieldLabel>
            <Input id="player-name" value={playerName} onChange={(event) => setPlayerName(event.target.value)} minLength={1} maxLength={16} autoComplete="username" required />
          </Field>
        </FieldGroup>
        <Button type="submit" className="h-10 w-full" disabled={profileBusy || (playerName === user.username && playerName === user.displayName)}>{profileBusy ? <Spinner /> : <Check />}이름 변경</Button>
      </form>
      <Separator />
      <form className="flex flex-col gap-4" onSubmit={changePassword}>
        <div className="flex items-center gap-2 font-medium"><KeyRound className="size-4" />비밀번호 변경</div>
        <FieldGroup className="gap-2">
          <Field><FieldLabel className="sr-only" htmlFor="current-password">현재 비밀번호</FieldLabel><Input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="현재 비밀번호" autoComplete="current-password" minLength={8} maxLength={128} required /></Field>
          <Field><FieldLabel className="sr-only" htmlFor="new-password">새 비밀번호</FieldLabel><Input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="새 비밀번호 (8글자 이상)" autoComplete="new-password" minLength={8} maxLength={128} required /></Field>
          <Field><FieldLabel className="sr-only" htmlFor="confirm-password">새 비밀번호 확인</FieldLabel><Input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="새 비밀번호 확인" autoComplete="new-password" minLength={8} maxLength={128} required /></Field>
        </FieldGroup>
        <Button type="submit" variant="outline" className="h-10 w-full" disabled={passwordBusy}>{passwordBusy ? <Spinner /> : <KeyRound />}비밀번호 변경</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
