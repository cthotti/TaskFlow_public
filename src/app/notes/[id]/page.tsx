// src/app/notes/[id]/page.tsx
import NoteEditor from "@/components/NoteEditor";

export default function NotePage({ params }: { params: { id: string } }) {
  return <NoteEditor noteId={params.id} />;
}

