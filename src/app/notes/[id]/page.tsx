// src/app/notes/[id]/page.tsx
import NoteEditor from "@/components/NoteEditor";

type Props = {
  params: Promise<{ id: string }>; // ✅ mark as Promise
};

export default async function NotePage({ params }: Props) {
  const { id } = await params; // ✅ await params
  return <NoteEditor noteId={id} />;
}
