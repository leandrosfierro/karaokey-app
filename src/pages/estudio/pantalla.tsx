import Head from "next/head";
import { useRouter } from "next/router";
import { ProgramOutput } from "../../components/preview/Player";
export default function StudioScreen() {
  const { query } = useRouter();
  return (
    <>
      <Head>
        <title>Karaokey · Pantalla del público</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <ProgramOutput
        authoritative
        channelId={typeof query.channel === "string" ? query.channel : ""}
      />
    </>
  );
}
