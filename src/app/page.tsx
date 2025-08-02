import Image from "next/image";
import HelloWorldBox from "../components/HelloWorldBox";

export default function Home() {
  return (
    <div className="grid place-items-center min-h-screen p-8">
      <main className="flex flex-col items-center gap-12">
        <Image src="/next.svg" alt="Next.js logo" width={180} height={38} />
        <HelloWorldBox />
      </main>
    </div>
  );
}
