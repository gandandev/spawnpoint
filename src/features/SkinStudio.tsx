import { DragEvent, FormEvent, useEffect, useState } from "react";
import { Check, Upload } from "lucide-react";
import { AnimatedHeight } from "@/components/portal";
import { CatalogSkinPreview } from "@/CatalogSkinPreview";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { BootstrapData, PublicUser, SkinCatalogCategory } from "@/types";

type StudioMode = "catalog" | "lookup" | "upload";

let catalogRequest: Promise<{ categories: SkinCatalogCategory[] }> | null = null;

function loadCatalog() {
  catalogRequest ??= api<{ categories: SkinCatalogCategory[] }>("/skin/catalog").catch((error) => {
    catalogRequest = null;
    throw error;
  });
  return catalogRequest;
}

interface SkinStudioProps {
  data: BootstrapData;
  onUser: (user: PublicUser) => void;
  onChanged: () => void;
  notice: (message: string) => void;
}

export function SkinStudio({ data, onUser, onChanged, notice }: SkinStudioProps) {
  const [mode, setMode] = useState<StudioMode>("catalog");
  const [categories, setCategories] = useState<SkinCatalogCategory[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [lookup, setLookup] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadCatalog()
      .then((result) => {
        if (active) setCategories(result.categories);
      })
      .catch(() => {
        if (active) setCatalogError(true);
      });
    return () => { active = false; };
  }, []);

  const update = async (key: string, path: string, options: RequestInit) => {
    setBusy(key);
    try {
      const result = await api<{ user: PublicUser }>(path, {
        ...options,
        headers: { "x-spawnpoint-csrf": data.csrf!, ...options.headers },
      });
      onUser(result.user);
      onChanged();
    } catch (error) {
      notice(error instanceof Error ? error.message : "스킨을 변경하지 못했어요");
    } finally {
      setBusy(null);
    }
  };

  const uploadSkin = (skinFile: File) => {
    const form = new FormData();
    form.append("skin", skinFile);
    void update("upload", "/skin/upload", { method: "POST", body: form });
  };
  const dropSkin = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const nextFile = event.dataTransfer.files[0];
    if (nextFile) setFile(nextFile);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "lookup") {
      void update("lookup", "/skin/fetch", { method: "POST", body: JSON.stringify({ username: lookup }), headers: { "Content-Type": "application/json" } });
    } else if (mode === "upload" && file) {
      uploadSkin(file);
    }
  };

  const famous = categories.find((category) => category.id === "famous");

  return <form className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-1" onSubmit={submit}>
    <ToggleGroup type="single" value={mode} onValueChange={(value) => { if (value === "catalog" || value === "lookup" || value === "upload") setMode(value); }} variant="outline" spacing={0} className="grid w-full grid-cols-3 p-1">
      <ToggleGroupItem value="catalog" className="h-auto min-h-10 min-w-0 w-full cursor-pointer whitespace-normal px-1 text-xs leading-tight sm:h-10 sm:px-2 sm:text-sm">고르기</ToggleGroupItem>
      <ToggleGroupItem value="lookup" className="h-auto min-h-10 min-w-0 w-full cursor-pointer whitespace-normal px-1 text-xs leading-tight sm:h-10 sm:px-2 sm:text-sm">이름으로 가져오기</ToggleGroupItem>
      <ToggleGroupItem value="upload" className="h-auto min-h-10 min-w-0 w-full cursor-pointer whitespace-normal px-1 text-xs leading-tight sm:h-10 sm:px-2 sm:text-sm">업로드</ToggleGroupItem>
    </ToggleGroup>
    <AnimatedHeight>
      <div className="flex flex-col gap-4">
        {mode === "catalog" ? <div className="grid max-h-[min(34rem,calc(100dvh-10rem))] grid-cols-3 gap-2 overflow-y-auto overscroll-contain pr-1" aria-label="유명 스킨">
          {!famous && !catalogError && <div className="col-span-3 flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />카탈로그 불러오는 중</div>}
          {catalogError && <div className="col-span-3 flex min-h-40 items-center justify-center text-sm text-muted-foreground">카탈로그를 불러오지 못했어요.</div>}
          {famous?.skins.map((skin, index) => {
            const selected = data.user?.skin.label === skin.label;
            return <button
              key={skin.id}
              type="button"
              className={cn("group relative flex min-h-44 cursor-pointer items-center justify-center rounded-lg border bg-muted/35 p-2 transition-all duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:bg-muted active:scale-[var(--scale-large)] active:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_10%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:active:scale-100", selected && "border-[#96ce4d] bg-[#96ce4d]/10")}
              aria-label={`스킨 ${index + 1} 선택`}
              aria-pressed={selected}
              disabled={busy !== null}
              onClick={() => void update(skin.id, "/skin/catalog", { method: "POST", body: JSON.stringify({ skinId: skin.id }), headers: { "Content-Type": "application/json" } })}
            >
              <CatalogSkinPreview src={skin.textureUrl} />
              {busy === skin.id ? <span className="absolute right-2 top-2"><Spinner /></span> : selected && <Check className="absolute right-2 top-2 size-3.5 text-[#65952c]" />}
            </button>;
          })}
        </div> : mode === "lookup" ? <Field><FieldLabel className="sr-only" htmlFor="skin-lookup">마인크래프트 사용자 이름</FieldLabel><Input className="h-11 px-4 shadow-none" id="skin-lookup" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="마인크래프트 이름 입력" required /></Field> : <Field><FieldLabel className="sr-only" htmlFor="skin-file">스킨 PNG 업로드</FieldLabel><label htmlFor="skin-file" onDragOver={(event) => event.preventDefault()} onDrop={dropSkin} className="flex min-h-52 touch-manipulation cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-input bg-muted/40 px-4 text-center text-sm text-muted-foreground transition-colors hover:bg-muted"><Upload /><span className="mt-2">{file ? file.name : "PNG 스킨을 선택하거나 여기에 놓으세요"}</span><input id="skin-file" className="sr-only" type="file" accept="image/png" disabled={busy !== null} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label></Field>}
        {mode !== "catalog" && <Button type="submit" size="lg" className="h-11 w-full" disabled={busy !== null || (mode === "lookup" ? !lookup.trim() : !file)}>{busy ? <Spinner /> : "선택"}</Button>}
      </div>
    </AnimatedHeight>
  </form>;
}
