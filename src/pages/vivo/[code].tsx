import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { motion, AnimatePresence } from "framer-motion";
import { Music2, Mic2, ListPlus, HandMetal, Loader2, PartyPopper } from "lucide-react";
import { supabase, isSupabaseConfigured, PerformanceRow } from "../../lib/supabase";
import { getDeviceId } from "../../lib/deviceId";
import { useToast } from "../../components/Toast";

// Modo Participativo's public entry point — no login, no useAuth. Reached by
// scanning the host's QR (or typing the code by hand). Every write here goes
// through a SECURITY DEFINER RPC (rpc_submit_tema_publico / rpc_registrar_aplauso)
// that re-validates the code itself server-side — nothing on this page is trusted
// just because it made it into a request payload.
const SUBMIT_COOLDOWN_MS = 20_000;
const VOTED_KEY_PREFIX = "karaokey-votado-";

type PartyState =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "ready"; hostUserId: string };

export default function VivoPage() {
  const router = useRouter();
  const toast = useToast();
  const rawCode = router.query.code;
  const code = typeof rawCode === "string" ? rawCode : Array.isArray(rawCode) ? rawCode[0] : undefined;

  const [party, setParty] = useState<PartyState>({ status: "loading" });
  const [tab, setTab] = useState<"sumar" | "votar">("sumar");
  const [deviceId, setDeviceId] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect -- getDeviceId() touches
     localStorage/crypto, which only exist client-side; it can't run during the
     server-rendered first pass, so it has to happen in an effect, not render */
  useEffect(() => {
    setDeviceId(getDeviceId());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Resolve the code once router.query is ready. rpc_resolve_party returns no
  // rows at all for an invalid or deactivated code — that's the "invalid" state,
  // same UI whether the code never existed or the host just turned the feature off.
  /* eslint-disable react-hooks/set-state-in-effect -- the router-not-ready-yet /
     misconfigured-env guard has to report "invalid" the same way the async RPC
     branch below does; it's not state derivable from props during render */
  useEffect(() => {
    if (!router.isReady) return;
    if (!isSupabaseConfigured || !code) {
      setParty({ status: "invalid" });
      return;
    }
    let cancelled = false;
    supabase
      .rpc("rpc_resolve_party", { p_code: code })
      .then(({ data, error }) => {
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        if (error || !row?.host_user_id) {
          setParty({ status: "invalid" });
        } else {
          setParty({ status: "ready", hostUserId: row.host_user_id });
        }
      });
    return () => { cancelled = true; };
  }, [router.isReady, code]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <>
      <Head>
        <title>KaraoKey | Sumate a la fiesta</title>
      </Head>
      <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-3xl font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-r from-[#FF3B81] via-[#9D4EDD] to-[#00B7ED]">
              KARAOKEY
            </h1>
            <p className="text-white/50 text-xs uppercase tracking-widest font-bold">Sumate a la fiesta</p>
          </div>

          {party.status === "loading" && (
            <div className="flex flex-col items-center gap-3 py-16 text-white/50">
              <Loader2 size={28} className="animate-spin" />
              <p className="text-sm">Buscando la fiesta...</p>
            </div>
          )}

          {party.status === "invalid" && (
            <div className="glass-card rounded-3xl p-6 text-center space-y-2 border border-white/5">
              <p className="text-lg font-bold">Este código no es válido</p>
              <p className="text-sm text-white/50">
                O la fiesta ya terminó. Pedile al anfitrión que te muestre el QR actualizado.
              </p>
            </div>
          )}

          {party.status === "ready" && deviceId && (
            <>
              <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/5">
                <button
                  onClick={() => setTab("sumar")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all cursor-pointer ${tab === "sumar" ? "bg-neon-pink/20 text-white" : "text-white/40 hover:text-white/70"}`}
                >
                  <ListPlus size={14} /> Sumar canción
                </button>
                <button
                  onClick={() => setTab("votar")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all cursor-pointer ${tab === "votar" ? "bg-neon-blue/20 text-white" : "text-white/40 hover:text-white/70"}`}
                >
                  <HandMetal size={14} /> Votar
                </button>
              </div>

              {tab === "sumar" ? (
                <SumarCancion code={code!} deviceId={deviceId} toast={toast} />
              ) : (
                <Votar code={code!} deviceId={deviceId} hostUserId={party.hostUserId} toast={toast} />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SumarCancion({ code, deviceId, toast }: { code: string; deviceId: string; toast: ReturnType<typeof useToast> }) {
  const [titulo, setTitulo] = useState("");
  const [artista, setArtista] = useState("");
  const [nombre, setNombre] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);

  // Just a ticking clock to keep the cooldown label ("Esperá 12s...") live.
  useEffect(() => {
    if (cooldownUntil === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  // `now` is always set in the same event-handler tick as cooldownUntil (see
  // handleSubmit below) and then ticked forward by the interval effect above,
  // so this never needs to fall back to a fresh Date.now() read during render.
  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const onCooldown = secondsLeft > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim() || onCooldown || submitting) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("rpc_submit_tema_publico", {
      p_code: code,
      p_titulo: titulo,
      p_artista: artista || null,
      p_submitted_by: nombre || null,
      p_device_id: deviceId,
    });
    setSubmitting(false);
    if (error) {
      if (error.message?.includes("rate_limited")) {
        toast("Esperá un poco antes de sumar otra canción.", { type: "error" });
      } else {
        toast("No se pudo sumar la canción. Probá de nuevo.", { type: "error" });
      }
      return;
    }
    toast(`¡"${titulo}" quedó anotada!`, { type: "success" });
    setTitulo("");
    setArtista("");
    setCooldownUntil(Date.now() + SUBMIT_COOLDOWN_MS);
    setNow(Date.now());
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-3xl p-5 space-y-4 border border-white/5"
    >
      <p className="text-sm text-white/60">Sumá una canción a la lista de espera del anfitrión.</p>
      <div className="space-y-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Título *</label>
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ej: De música ligera"
          maxLength={120}
          className="w-full p-3 bg-black/30 border border-white/10 rounded-xl text-sm outline-none focus:border-neon-pink/40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Artista</label>
        <input
          value={artista}
          onChange={(e) => setArtista(e.target.value)}
          placeholder="Ej: Soda Stereo"
          maxLength={120}
          className="w-full p-3 bg-black/30 border border-white/10 rounded-xl text-sm outline-none focus:border-neon-pink/40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Tu nombre</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Para que sepan quién la sumó"
          maxLength={60}
          className="w-full p-3 bg-black/30 border border-white/10 rounded-xl text-sm outline-none focus:border-neon-pink/40"
        />
      </div>
      <button
        type="submit"
        disabled={!titulo.trim() || submitting || onCooldown}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-linear-to-r from-[#FF3B81] to-[#9D4EDD] font-bold uppercase text-xs tracking-widest disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
      >
        <Music2 size={16} /> {onCooldown ? `Esperá ${secondsLeft}s...` : "Sumar canción"}
      </button>
    </motion.form>
  );
}

function Votar({
  code,
  deviceId,
  hostUserId,
  toast,
}: {
  code: string;
  deviceId: string;
  hostUserId: string;
  toast: ReturnType<typeof useToast>;
}) {
  const [performance, setPerformance] = useState<PerformanceRow | null>(null);
  const [aplausos, setAplausos] = useState(0);
  const [voting, setVoting] = useState(false);
  // Which performance ids this device already voted for — state, not a ref,
  // because `yaVoto` below reads it during render (a ref can't be read there).
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());

  // Load the localStorage copy (reinforced server-side by the
  // unique(performance_id, device_id) constraint) — this is just so the button
  // shows "ya aplaudiste" without a round trip.
  /* eslint-disable react-hooks/set-state-in-effect -- reading localStorage only
     works client-side, so this can't happen during the server-rendered pass */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VOTED_KEY_PREFIX + deviceId);
      if (raw) setVotedIds(new Set(JSON.parse(raw)));
    } catch {
      // ignore — worst case the button doesn't remember across reloads
    }
  }, [deviceId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Live "who's on stage" — initial fetch + realtime subscription.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("karaokey_performances")
      .select("*")
      .eq("user_id", hostUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPerformance(data ?? null);
      });
    const channel = supabase
      .channel(`performance-${hostUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "karaokey_performances", filter: `user_id=eq.${hostUserId}` },
        (payload) => setPerformance((payload.new as PerformanceRow) ?? null)
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [hostUserId]);

  // Live applause count for whichever performance is current — reseeded whenever
  // performance.id changes (a new song starting resets the tally, as intended).
  /* eslint-disable react-hooks/set-state-in-effect -- resetting the tally the
     instant the performance identity changes is the point of this effect */
  useEffect(() => {
    if (!performance?.id) {
      setAplausos(0);
      return;
    }
    let cancelled = false;
    supabase
      .from("karaokey_aplausos")
      .select("id", { count: "exact", head: true })
      .eq("performance_id", performance.id)
      .then(({ count }) => {
        if (!cancelled) setAplausos(count ?? 0);
      });
    const channel = supabase
      .channel(`aplausos-${performance.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "karaokey_aplausos", filter: `performance_id=eq.${performance.id}` },
        () => setAplausos((prev) => prev + 1)
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [performance?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const yaVoto = performance ? votedIds.has(performance.id) : false;

  const handleAplaudir = async () => {
    if (!performance || yaVoto || voting) return;
    setVoting(true);
    const { error } = await supabase.rpc("rpc_registrar_aplauso", {
      p_code: code,
      p_performance_id: performance.id,
      p_device_id: deviceId,
    });
    setVoting(false);
    if (error) {
      toast("No se pudo registrar tu aplauso.", { type: "error" });
      return;
    }
    const next = new Set(votedIds).add(performance.id);
    setVotedIds(next);
    try {
      localStorage.setItem(VOTED_KEY_PREFIX + deviceId, JSON.stringify([...next]));
    } catch {
      // ignore
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-3xl p-6 text-center space-y-5 border border-white/5"
    >
      <AnimatePresence mode="wait">
        {!performance ? (
          <motion.div key="empty" className="space-y-2 py-6" exit={{ opacity: 0 }}>
            <Mic2 size={28} className="mx-auto text-white/30" />
            <p className="text-sm text-white/50">Todavía no hay nadie en el escenario.</p>
          </motion.div>
        ) : (
          <motion.div key={performance.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Está cantando</p>
              <p className="text-xl font-black">{performance.participantes.join(" & ")}</p>
              {performance.cancion_titulo && (
                <p className="text-sm text-white/60">
                  {performance.cancion_titulo}
                  {performance.cancion_artista ? <span className="opacity-50"> — {performance.cancion_artista}</span> : null}
                </p>
              )}
            </div>

            <button
              onClick={handleAplaudir}
              disabled={yaVoto || voting}
              className={`w-full flex flex-col items-center justify-center gap-1 py-6 rounded-2xl font-bold uppercase text-xs tracking-widest transition-all cursor-pointer disabled:cursor-not-allowed ${
                yaVoto ? "bg-white/5 text-white/40" : "bg-linear-to-r from-[#00B7ED] to-[#9D4EDD] active:scale-95"
              }`}
            >
              <span className="text-4xl leading-none" aria-hidden>👏</span>
              {yaVoto ? "¡Ya aplaudiste!" : "Aplaudir"}
            </button>

            <p className="text-2xl font-black text-neon-blue flex items-center justify-center gap-2">
              <PartyPopper size={20} /> {aplausos}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
