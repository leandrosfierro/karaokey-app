import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import {
  X,
  Search,
  Check,
  Music2,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";
import type { PreviewSong } from "../../lib/preview/model";
export type SongSearch = (
  query: string,
  kind?: "search" | "playlist" | "channel",
) => Promise<PreviewSong[]>;

export async function previewApi<T = any>(
  action: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/prueba/${action}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      data.error ||
        "No se pudo conectar. Tus cambios anteriores siguen guardados.",
    );
  return data;
}
export function PreviewBadge() {
  return (
    <div className="trial-banner">
      <span className="trial-dot" /> Versión de prueba · Datos separados{" "}
      <span className="trial-banner-detail">Solo para explorar y probar</span>
    </div>
  );
}
export function Brand() {
  return (
    <span className="trial-brand">
      Karaokey<span>by LSF Producciones</span>
    </span>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <p
      className={`trial-notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="trial-empty">
      <Music2 size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="trial trial-dialog"
      aria-labelledby={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="trial-dialog-inner">
        <div className="trial-section-heading">
          <h2 id={label}>{title}</h2>
          <button className="trial-icon" aria-label="Cerrar" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function SongRow({
  song,
  actions,
  selected = false,
}: {
  song: PreviewSong;
  actions?: React.ReactNode;
  selected?: boolean;
}) {
  return (
    <div className={`trial-song ${selected ? "selected" : ""}`}>
      {song.kind === "local" ? (
        <span className="trial-cover-local">
          <Music2 />
        </span>
      ) : (
        <Image
          src={song.thumbnail}
          alt=""
          width="112"
          height="63"
          loading="lazy"
          unoptimized
        />
      )}
      <div className="trial-song-info">
        <strong>{song.title}</strong>
        <span>
          {song.channel ||
            (song.kind === "local"
              ? "Archivo de este dispositivo"
              : "Video de YouTube")}
          {song.duration ? ` · ${song.duration}` : ""}
        </span>
      </div>
      {selected && <Check className="trial-check" size={18} />}
      <div className="trial-song-actions">{actions}</div>
    </div>
  );
}
export function SongBrowser({
  songs,
  code,
  onChoose,
  onSave,
  onClose,
  initialTab = "youtube",
  onSearch,
  initialQuery = "",
}: {
  songs: PreviewSong[];
  code?: string;
  onChoose: (song: PreviewSong) => void;
  onSave?: (songs: PreviewSong[]) => Promise<void>;
  onClose: () => void;
  initialTab?: "youtube" | "saved" | "import";
  onSearch?: SongSearch;
  initialQuery?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<PreviewSong[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importText, setImportText] = useState("");
  const [saving, setSaving] = useState(false);
  const search = async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = onSearch
        ? { results: await onSearch(query) }
        : await previewApi<{ results: PreviewSong[] }>(
            `search?q=${encodeURIComponent(query)}${code ? `&code=${code}` : ""}`,
          );
      setResults(data.results);
      if (!data.results.length)
        setError("No encontramos resultados. Probá con título y artista.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importSongs = async () => {
    setBusy(true);
    setError("");
    const found: PreviewSong[] = [];
    try {
      const lines = importText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length > 20)
        throw new Error(
          "Pegá hasta 20 enlaces de videos, playlists o canales por vez.",
        );
      for (const url of lines) {
        if (
          !/^https:\/\/(www\.|music\.|m\.)?(youtube\.com|youtu\.be)\//.test(url)
        )
          throw new Error(
            "Usá enlaces de YouTube: así conservamos la versión exacta.",
          );
        const kind =
          /youtube\.com\/(?:@[^/?#]+|channel\/UC[\w-]+)/i.test(url)
            ? "channel"
            : /[?&]list=/.test(url) && !/[?&]v=/.test(url)
              ? "playlist"
              : "search";
        const data = onSearch
          ? { results: await onSearch(url, kind) }
          : await previewApi<{ results: PreviewSong[] }>(
              `search?q=${encodeURIComponent(url)}&kind=${kind}`,
            );
        found.push(...data.results);
      }
      setResults(
        [...new Map(found.map((s) => [s.id, s])).values()],
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!onSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave(results);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const visible =
    tab === "saved"
      ? songs.filter((s) =>
          (s.title + " " + s.channel)
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        )
      : results;
  return (
    <Modal title="Elegí la canción y su versión" onClose={onClose}>
      <p className="trial-muted">
        Buscar no cambia lo que está sonando. Vos elegís qué cargar.
      </p>
      <div className="trial-tabs" aria-label="Fuentes de canciones">
        {(
          [
            ["youtube", "YouTube"],
            ["saved", "Canciones guardadas"],
            ...(onSave ? [["import", "Importar lista"]] : []),
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id as typeof tab);
              setResults([]);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "import" ? (
        <div className="trial-stack">
          <label>
            Enlaces de videos, playlists o canales públicos
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={4}
              placeholder="Un enlace por línea. Podés pegar varios canales completos."
            />
          </label>
          <button
            className="trial-button"
            disabled={busy || !importText.trim()}
            onClick={importSongs}
          >
            {busy ? <LoaderCircle className="trial-spin" /> : <Search />}{" "}
            Revisar canciones
          </button>
        </div>
      ) : (
        <form
          className="trial-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (tab === "youtube") void search();
          }}
        >
          <label className="trial-search-input">
            <Search size={20} />
            <input
              autoFocus
              aria-label={
                tab === "saved"
                  ? "Buscar en canciones guardadas"
                  : "Buscar en YouTube o pegar enlace"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                tab === "saved"
                  ? "Buscar en tus canciones…"
                  : "Título, artista o enlace de YouTube…"
              }
            />
          </label>
          {tab === "youtube" && (
            <button className="trial-button" disabled={busy || !query.trim()}>
              {busy ? <LoaderCircle className="trial-spin" /> : "Buscar"}
            </button>
          )}
        </form>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="trial-results">
        {visible.slice(0, 100).map((song) => (
          <SongRow
            key={song.id}
            song={song}
            actions={
              <button
                className="trial-button secondary small"
                onClick={() => onChoose(song)}
              >
                Elegir <ArrowRight size={16} />
              </button>
            }
          />
        ))}
        {visible.length > 100 && (
          <Notice>
            Mostramos 100 de {visible.length} versiones para mantener la vista
            fluida. Al guardar se incorporarán todas.
          </Notice>
        )}
        {!visible.length && !busy && !error && (
          <Empty
            title={
              tab === "saved" ? "Tus canciones, a mano" : "Encontrá tu karaoke"
            }
          >
            {tab === "saved"
              ? "Guardá una versión desde YouTube para volver a usarla."
              : "Buscá y revisá el título completo y el canal antes de elegir."}
          </Empty>
        )}
      </div>
      {tab === "import" && results.length > 0 && onSave && (
        <button className="trial-button full" onClick={save} disabled={saving}>
          Guardar {results.length} versiones en mi biblioteca
        </button>
      )}
    </Modal>
  );
}
