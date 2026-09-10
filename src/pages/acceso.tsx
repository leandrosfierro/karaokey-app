import { useEffect } from "react";
import type { ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { BarChart3, LogOut, Mic2, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function AccesoAdministrador() {
  const router = useRouter();
  const { user, loading, isSuperadmin, adminLoading, signOut } = useAuth();

  useEffect(() => {
    if (!loading && !user) void router.replace("/login?next=/acceso");
  }, [loading, user, router]);

  useEffect(() => {
    if (!loading && user && !adminLoading && !isSuperadmin)
      void router.replace("/");
  }, [loading, user, adminLoading, isSuperadmin, router]);

  if (loading || adminLoading || !user || !isSuperadmin)
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 text-white/60">
        <span className="w-10 h-10 rounded-full border-4 border-white/20 border-t-neon-pink animate-spin" />
        <p className="text-sm font-bold uppercase tracking-widest">
          Preparando tu acceso…
        </p>
      </main>
    );

  return (
    <main className="min-h-screen px-4 py-10 flex items-center justify-center text-white">
      <Head>
        <title>Elegí dónde entrar · Karaokey</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <section className="w-full max-w-4xl space-y-8">
        <header className="text-center space-y-3">
          <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-neon-pink">
            <Sparkles size={15} /> Acceso administrador
          </span>
          <h1 className="text-4xl sm:text-6xl font-black tracking-tight">
            ¿Dónde querés entrar?
          </h1>
          <p className="text-white/50">
            Tu cuenta tiene acceso a Karaokey y al control general de la plataforma.
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-5">
          <AccessCard
            href="/"
            icon={<Mic2 />}
            eyebrow="Operación"
            title="Entrar a Karaokey"
            description="Prepará la fiesta, administrá turnos, canciones y el escenario."
            action="Abrir la app"
            accent="pink"
          />
          <AccessCard
            href="/superadmin"
            icon={<BarChart3 />}
            eyebrow="Administración"
            title="Abrir Dashboard"
            description="Consultá cuentas registradas, actividad, canciones y uso en tiempo real."
            action="Ver dashboard"
            accent="blue"
          />
        </div>

        <div className="text-center">
          <button
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 min-h-11 px-4 text-sm font-bold text-white/45 hover:text-white transition-colors cursor-pointer"
          >
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </section>
    </main>
  );
}

function AccessCard({
  href,
  icon,
  eyebrow,
  title,
  description,
  action,
  accent,
}: {
  href: string;
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  accent: "pink" | "blue";
}) {
  const tone =
    accent === "pink"
      ? "border-[#FF3B81]/30 hover:border-[#FF3B81]/70 hover:shadow-[#FF3B81]/15"
      : "border-[#00B7ED]/30 hover:border-[#00B7ED]/70 hover:shadow-[#00B7ED]/15";
  const iconTone = accent === "pink" ? "bg-[#FF3B81]" : "bg-[#00B7ED]";
  return (
    <Link
      href={href}
      className={`group glass-card min-h-72 rounded-3xl border p-7 sm:p-9 flex flex-col items-start transition-all hover:-translate-y-1 hover:shadow-2xl ${tone}`}
    >
      <span className={`w-14 h-14 rounded-2xl grid place-items-center ${iconTone}`}>
        {icon}
      </span>
      <span className="mt-7 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
        {eyebrow}
      </span>
      <h2 className="mt-2 text-2xl sm:text-3xl font-black">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-white/50">{description}</p>
      <span className="mt-auto pt-7 text-xs font-black uppercase tracking-widest group-hover:text-white transition-colors">
        {action} →
      </span>
    </Link>
  );
}
