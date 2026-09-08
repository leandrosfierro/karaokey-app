import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import "../styles/globals.css";
import "../styles/preview.css";
import { useRouter } from 'next/router';
import { ToastProvider } from "../components/Toast";
import { AuthProvider } from "../lib/auth";

const inter = Inter({ subsets: ["latin"] });

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  // Trial pages use an isolated local API. Never mount the production auth provider.
  if (router.pathname.startsWith('/prueba')) return <div className={inter.className}><Component {...pageProps}/></div>;
  return (
    <div className={inter.className}>
      <AuthProvider>
        <ToastProvider>
          <Component {...pageProps} />
        </ToastProvider>
      </AuthProvider>
    </div>
  );
}
