import { FormEvent, useEffect, useMemo, useState } from "react";
import { Blocks, Earth, Save, Shield, SlidersHorizontal } from "@/components/pixel-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ServerDifficulty, ServerGameMode, ServerSettings } from "@/types";

type SettingsCategory = "general" | "world" | "gameplay" | "access";

const CATEGORIES: Array<{ id: SettingsCategory; label: string; icon: typeof SlidersHorizontal }> = [
  { id: "general", label: "일반", icon: SlidersHorizontal },
  { id: "world", label: "월드", icon: Earth },
  { id: "gameplay", label: "게임", icon: Blocks },
  { id: "access", label: "접속", icon: Shield },
];

const selectClassName = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function SettingSwitch({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return <div className="admin-setting-row">
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
  </div>;
}

function SettingField({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return <label className="admin-setting-field">
    <span className="min-w-0"><span className="block text-sm font-medium">{label}</span>
    <span className="block text-xs leading-relaxed text-muted-foreground">{description}</span></span>
    <span className="admin-setting-control">{children}</span>
  </label>;
}

export function AdminServerSettings({ settings, serverOnline, busy, onSave }: {
  settings: ServerSettings;
  serverOnline: boolean;
  busy: boolean;
  onSave: (settings: ServerSettings) => Promise<ServerSettings | null>;
}) {
  const [category, setCategory] = useState<SettingsCategory>("general");
  const [draft, setDraft] = useState(settings);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(settings);
  }, [dirty, settings]);

  const changed = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);
  const update = <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await onSave(draft);
    if (!saved) return;
    setDraft(saved);
    setDirty(false);
  };

  return <form className="admin-settings-layout" onSubmit={submit}>
    <nav className="admin-settings-nav" aria-label="서버 설정 분류">
      {CATEGORIES.map(({ id, label, icon: Icon }) => <button
        key={id}
        type="button"
        className={cn("admin-settings-nav-button", category === id && "is-selected")}
        aria-current={category === id ? "page" : undefined}
        onClick={() => setCategory(id)}
      ><Icon />{label}</button>)}
    </nav>
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-start gap-2 px-1 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">서버 설정</div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">대부분 다음 서버 시작 때 적용됩니다. TPA와 인벤토리 유지는 온라인 서버에도 바로 적용됩니다.</div>
        </div>
        <span className={cn("rounded-full px-2 py-1 text-[11px] font-medium", serverOnline ? "bg-[#96ce4d]/15 text-[#65952c]" : "bg-muted text-muted-foreground")}>{serverOnline ? "온라인" : "오프라인"}</span>
      </div>

      <section className="admin-settings-section" hidden={category !== "general"}>
        <SettingField label="서버 설명" description="멀티플레이 서버 목록에 표시되는 문구입니다."><Input value={draft.motd} maxLength={80} onChange={(event) => update("motd", event.target.value)} /></SettingField>
        <div className="grid gap-0">
          <SettingField label="최대 플레이어" description="동시에 접속할 수 있는 인원입니다."><Input type="number" min={2} max={40} value={draft.maxPlayers} onChange={(event) => update("maxPlayers", Number(event.target.value))} /></SettingField>
          <SettingField label="시야 거리" description="멀리 보이는 청크 수입니다. 높으면 메모리를 더 씁니다."><Input type="number" min={2} max={12} value={draft.viewDistance} onChange={(event) => update("viewDistance", Number(event.target.value))} /></SettingField>
          <SettingField label="잠수 퇴장" description="입력한 분 동안 움직이지 않으면 퇴장시킵니다. 0은 끄기입니다."><Input type="number" min={0} max={120} value={draft.playerIdleTimeout} onChange={(event) => update("playerIdleTimeout", Number(event.target.value))} /></SettingField>
          <SettingField label="기본 게임 모드" description="처음 접속한 플레이어에게 적용됩니다."><select className={selectClassName} value={draft.defaultGameMode} onChange={(event) => update("defaultGameMode", event.target.value as ServerGameMode)}><option value="survival">서바이벌</option><option value="creative">크리에이티브</option><option value="adventure">모험</option><option value="spectator">관전자</option></select></SettingField>
        </div>
        <SettingSwitch label="게임 모드 강제" description="접속할 때 모든 플레이어를 기본 게임 모드로 바꿉니다." checked={draft.forceGameMode} onChange={(value) => update("forceGameMode", value)} />
      </section>

      <section className="admin-settings-section" hidden={category !== "world"}>
        <SettingField label="난이도" description="적의 공격력과 허기 감소에 영향을 줍니다."><select className={selectClassName} value={draft.difficulty} onChange={(event) => update("difficulty", event.target.value as ServerDifficulty)}><option value="peaceful">평화로움</option><option value="easy">쉬움</option><option value="normal">보통</option><option value="hard">어려움</option></select></SettingField>
        <SettingSwitch label="하드코어" description="죽으면 관전자 모드가 됩니다." checked={draft.hardcore} onChange={(value) => update("hardcore", value)} />
        <SettingSwitch label="네더 허용" description="네더 차원과 포털을 사용할 수 있게 합니다." checked={draft.allowNether} onChange={(value) => update("allowNether", value)} />
        <SettingSwitch label="구조물 생성" description="마을, 사원, 요새 같은 구조물을 생성합니다." checked={draft.generateStructures} onChange={(value) => update("generateStructures", value)} />
        <SettingSwitch label="동물 생성" description="수동적인 동물이 자연 생성됩니다." checked={draft.spawnAnimals} onChange={(value) => update("spawnAnimals", value)} />
        <SettingSwitch label="몬스터 생성" description="적대적인 몬스터가 자연 생성됩니다." checked={draft.spawnMonsters} onChange={(value) => update("spawnMonsters", value)} />
        <SettingSwitch label="주민 생성" description="주민 같은 NPC가 자연 생성됩니다." checked={draft.spawnNpcs} onChange={(value) => update("spawnNpcs", value)} />
      </section>

      <section className="admin-settings-section" hidden={category !== "gameplay"}>
        <SettingSwitch label="PVP" description="플레이어끼리 피해를 줄 수 있게 합니다." checked={draft.pvp} onChange={(value) => update("pvp", value)} />
        <SettingSwitch label="비행 허용" description="서버의 비행 감지를 끕니다. 크리에이티브 비행은 이 값과 무관합니다." checked={draft.allowFlight} onChange={(value) => update("allowFlight", value)} />
        <SettingSwitch label="사망 시 인벤토리 유지" description="죽어도 아이템과 경험치를 잃지 않습니다." checked={draft.keepInventory} onChange={(value) => update("keepInventory", value)} />
        <SettingSwitch label="TPA 요청" description="플레이어끼리 순간이동 요청을 보낼 수 있게 합니다." checked={draft.tpaEnabled} onChange={(value) => update("tpaEnabled", value)} />
      </section>

      <section className="admin-settings-section" hidden={category !== "access"}>
        <SettingSwitch label="화이트리스트" description="허용 목록에 등록된 플레이어만 접속할 수 있습니다." checked={draft.whiteList} onChange={(value) => update("whiteList", value)} />
        <SettingSwitch label="명령 블록" description="월드 안의 명령 블록을 실행할 수 있게 합니다." checked={draft.commandBlocks} onChange={(value) => update("commandBlocks", value)} />
      </section>

      <div className="sticky bottom-0 mt-3 flex items-center justify-end gap-2 border-t bg-background py-3">
        {changed && <span className="mr-auto text-xs text-muted-foreground">저장하지 않은 변경이 있어요.</span>}
        <Button type="button" variant="outline" disabled={busy || !changed} onClick={() => { setDraft(settings); setDirty(false); }}>되돌리기</Button>
        <Button type="submit" disabled={busy || !changed}>{busy ? <Spinner /> : <Save />}설정 저장</Button>
      </div>
    </div>
  </form>;
}
